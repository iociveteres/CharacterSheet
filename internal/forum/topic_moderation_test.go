package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// logRow is a row of forum_mod_log; a target that is NULL reads as 0.
type logRow struct {
	ModeratorID int
	Action      string
	TopicID     int
	PostID      int
	SectionID   int
	UserID      int
	Reason      string
	Data        map[string]any
}

func modLog(t *testing.T, db *pgxpool.Pool) []logRow {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT moderator_id, action, COALESCE(topic_id, 0), COALESCE(post_id, 0), COALESCE(section_id, 0),
		       COALESCE(user_id, 0), reason, data
		FROM forum_mod_log ORDER BY id`)
	assert.NilError(t, err)
	log, err := pgx.CollectRows(rows, pgx.RowToStructByPos[logRow])
	assert.NilError(t, err)
	return log
}

func modURL(topicID int, action topicAction) string {
	return fmt.Sprintf("/forum/topic/%d/mod/%s", topicID, action)
}

// sectionCounts is the home's counters of the section as a guest sees them.
func sectionCounts(t *testing.T, f *Forum, sectionID int) sectionSummary {
	t.Helper()
	sections, err := f.sections(context.Background(), Viewer{})
	assert.NilError(t, err)
	for _, s := range sections {
		if s.ID == sectionID {
			return s
		}
	}
	t.Fatalf("no section %d", sectionID)
	return sectionSummary{}
}

// Every action on a topic changes it and writes its line of the log, with the reason and what the
// topic no longer shows; the browser goes back to the topic.
func TestModerateTopic(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	f.now = func() time.Time { return at(100) }
	alice := forumtest.User(t, db, "alice", at(0))
	mod := newModerator(t, db, "mod")
	from := newSection(t, db, "from")
	to := newSection(t, db, "to")
	topic, _ := mustCreateTopic(t, f, from, alice, "old title", at(1))
	h.userID = mod

	steps := []struct {
		action topicAction
		form   url.Values
		check  func(Topic)
		log    string
		data   map[string]any
	}{
		{topicRename, url.Values{"title": {"  new title  "}}, func(t2 Topic) { assert.Equal(t, t2.Title, "new title") },
			"topic.rename", map[string]any{"title": "old title"}},
		{topicPin, nil, func(t2 Topic) { assert.Equal(t, t2.Pinned, true) }, "topic.pin", nil},
		{topicUnpin, nil, func(t2 Topic) { assert.Equal(t, t2.Pinned, false) }, "topic.unpin", nil},
		{topicClose, nil, func(t2 Topic) { assert.Equal(t, t2.Closed, true) }, "topic.close", nil},
		{topicOpen, nil, func(t2 Topic) { assert.Equal(t, t2.Closed, false) }, "topic.open", nil},
		{topicMove, url.Values{"section": {fmt.Sprint(to)}}, func(t2 Topic) { assert.Equal(t, t2.SectionID, to) },
			"topic.move", map[string]any{"fromSection": float64(from)}},
		{topicDelete, nil, func(t2 Topic) {
			assert.Equal(t, t2.Deleted(), true)
			assert.Equal(t, t2.DeletedAt.Equal(at(100)), true)
		}, "topic.delete", nil},
		{topicRestore, nil, func(t2 Topic) { assert.Equal(t, t2.Deleted(), false) }, "topic.restore", nil},
	}
	for i, step := range steps {
		// The page of the action first, as the menu's link opens it.
		h.get(t, f, modURL(topic, step.action))
		assert.Equal(t, h.status, http.StatusOK)
		assert.Equal(t, h.page.NoIndex, true)

		form := url.Values{"reason": {fmt.Sprintf("reason %d", i)}}
		for k, v := range step.form {
			form[k] = v
		}
		assert.Equal(t, redirectedTo(t, h.post(t, f, modURL(topic, step.action), form)), fmt.Sprintf("/forum/topic/%d", topic))
		step.check(readTopic(t, db, topic))

		log := modLog(t, db)
		assert.Equal(t, len(log), i+1)
		got := log[i]
		assert.Equal(t, got.Action, step.log)
		assert.Equal(t, got.ModeratorID, mod)
		assert.Equal(t, got.TopicID, topic)
		assert.Equal(t, got.PostID, 0)
		assert.Equal(t, got.UserID, 0)
		assert.Equal(t, got.Reason, fmt.Sprintf("reason %d", i))
		if step.action == topicMove {
			assert.Equal(t, got.SectionID, to)
		} else {
			assert.Equal(t, got.SectionID, 0)
		}
		want := step.data
		if want == nil {
			want = map[string]any{}
		}
		assert.Equal(t, fmt.Sprint(got.Data), fmt.Sprint(want))
	}

	// What is already so writes nothing: a form sent twice, a stale menu.
	redirectedTo(t, h.post(t, f, modURL(topic, topicPin), url.Values{}))
	redirectedTo(t, h.post(t, f, modURL(topic, topicPin), url.Values{}))
	redirectedTo(t, h.post(t, f, modURL(topic, topicRename), url.Values{"title": {"new title"}}))
	redirectedTo(t, h.post(t, f, modURL(topic, topicOpen), url.Values{}))
	assert.Equal(t, len(modLog(t, db)), len(steps)+1)
}

// A wrong field gives the form back with 422 and changes nothing.
func TestModerateTopicErrors(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	h.userID = newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	topic, _ := mustCreateTopic(t, f, section, alice, "title", at(1))

	for _, tt := range []struct {
		action topicAction
		form   url.Values
		field  string
	}{
		{topicRename, url.Values{"title": {"  "}}, "title"},
		{topicRename, url.Values{"title": {"ab"}}, "title"},
		{topicRename, url.Values{"title": {strings.Repeat("a", titleMaxChars+1)}}, "title"},
		{topicMove, url.Values{"section": {fmt.Sprint(section)}}, "section"},
		{topicMove, url.Values{"section": {"999999"}}, "section"},
		{topicMove, url.Values{"section": {"x"}}, "section"},
		{topicPin, url.Values{"reason": {strings.Repeat("я", reasonMaxChars+1)}}, "reason"},
	} {
		h.post(t, f, modURL(topic, tt.action), tt.form)
		assert.Equal(t, h.status, http.StatusUnprocessableEntity)
		assert.StringContains(t, string(h.page.Body), `id="forum-mod-`+tt.field+`-error"`)
	}
	// The typed text comes back.
	h.post(t, f, modURL(topic, topicRename), url.Values{"title": {"ab"}, "reason": {"why"}})
	assert.StringContains(t, string(h.page.Body), `value="ab"`)
	assert.StringContains(t, string(h.page.Body), `>why</textarea>`)

	got := readTopic(t, db, topic)
	assert.Equal(t, got.Title, "title")
	assert.Equal(t, got.SectionID, section)
	assert.Equal(t, got.Pinned, false)
	assert.Equal(t, len(modLog(t, db)), 0)
}

// Only a moderator reaches the pages of the actions; nobody else changes anything.
func TestModerateTopicRefused(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	mod := newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	other := newSection(t, db, "other")
	topic, _ := mustCreateTopic(t, f, section, alice, "title", at(1))
	deleted, _ := mustCreateTopic(t, f, section, alice, "deleted", at(2))
	deleteTopic(t, db, deleted)
	actions := []topicAction{topicRename, topicPin, topicUnpin, topicClose, topicOpen, topicMove, topicDelete, topicRestore}
	form := url.Values{"title": {"new title"}, "section": {fmt.Sprint(other)}, "reason": {"why"}}

	// A guest goes to sign in and back.
	for _, a := range actions {
		assert.Equal(t, redirectedTo(t, h.get(t, f, modURL(topic, a))), "/user/login")
		assert.Equal(t, redirectedTo(t, h.post(t, f, modURL(topic, a), form)), "/user/login")
	}

	// The author of the topic, and a member under a ban: 403 where they read the topic, 404 where
	// they don't.
	banned := forumtest.User(t, db, "banned", at(0))
	_, err := db.Exec(context.Background(), `
		INSERT INTO forum_bans (user_id, moderator_id, reason) VALUES ($1, $2, 'spam')`, banned, mod)
	assert.NilError(t, err)
	for _, user := range []int{alice, banned} {
		h.userID = user
		for _, a := range actions {
			assert.Equal(t, h.get(t, f, modURL(topic, a)).Code, http.StatusForbidden)
			assert.Equal(t, h.post(t, f, modURL(topic, a), form).Code, http.StatusForbidden)
			h.post(t, f, modURL(deleted, a), form)
			assert.Equal(t, h.notFound, true)
		}
	}

	// A moderator: a topic that stands is not restored, a deleted one only restored.
	h.userID = mod
	assert.Equal(t, h.post(t, f, modURL(topic, topicRestore), form).Code, http.StatusForbidden)
	for _, a := range actions[:len(actions)-1] {
		assert.Equal(t, h.post(t, f, modURL(deleted, a), form).Code, http.StatusForbidden)
	}
	// An action that is not one, a topic that is not one.
	h.get(t, f, modURL(topic, "explode"))
	assert.Equal(t, h.notFound, true)
	h.post(t, f, modURL(999999, topicPin), form)
	assert.Equal(t, h.notFound, true)

	got := readTopic(t, db, topic)
	assert.Equal(t, got.Title, "title")
	assert.Equal(t, got.SectionID, section)
	assert.Equal(t, got.Pinned || got.Closed || got.Deleted(), false)
	assert.Equal(t, readTopic(t, db, deleted).Deleted(), true)
	assert.Equal(t, len(modLog(t, db)), 0)
}

// A moved topic takes its topics and posts from the counters of one section to the other's.
func TestMoveTopicCounters(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	h.userID = newModerator(t, db, "mod")
	from := newSection(t, db, "from")
	to := newSection(t, db, "to")
	stays, _ := mustCreateTopic(t, f, from, alice, "stays", at(1))
	moves, _ := mustCreateTopic(t, f, from, alice, "moves", at(2))
	last := mustReply(t, f, moves, bob, "reply", at(3))
	_, _ = stays, last

	before := sectionCounts(t, f, from)
	assert.Equal(t, before.TopicCount, 2)
	assert.Equal(t, before.PostCount, 3)
	assert.Equal(t, before.LastPost.PostID, last)

	redirectedTo(t, h.post(t, f, modURL(moves, topicMove), url.Values{"section": {fmt.Sprint(to)}}))

	left := sectionCounts(t, f, from)
	assert.Equal(t, left.TopicCount, 1)
	assert.Equal(t, left.PostCount, 1)
	assert.Equal(t, left.LastPost.TopicID, stays)
	came := sectionCounts(t, f, to)
	assert.Equal(t, came.TopicCount, 1)
	assert.Equal(t, came.PostCount, 2)
	assert.Equal(t, came.LastPost.PostID, last)

	// The section pages list it in its new place only.
	rows, err := f.sectionTopics(context.Background(), from, 1, Viewer{})
	assert.NilError(t, err)
	assert.Equal(t, strings.Join(topicTitles(rows), ","), "stays")
	rows, err = f.sectionTopics(context.Background(), to, 1, Viewer{})
	assert.NilError(t, err)
	assert.Equal(t, strings.Join(topicTitles(rows), ","), "moves")
}

// A deleted topic is not found by anyone but moderators and leaves the lists and counters of its
// section; restored, it comes back to them.
func TestDeleteAndRestoreTopic(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	mod := newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	stays, _ := mustCreateTopic(t, f, section, alice, "stays", at(1))
	topic, first := mustCreateTopic(t, f, section, alice, "deleted", at(2))
	reply := mustReply(t, f, topic, alice, "reply", at(3))
	_ = stays
	pages := []string{
		fmt.Sprintf("/forum/topic/%d", topic),
		fmt.Sprintf("/forum/topic/%d/unread", topic),
		postURL(first),
		postURL(reply),
	}
	visible := func(want bool) {
		t.Helper()
		for _, user := range []int{0, alice} {
			h.userID = user
			for _, page := range pages {
				h.get(t, f, page)
				assert.Equal(t, h.notFound, !want)
			}
			rows, err := f.sectionTopics(context.Background(), section, 1, Viewer{ID: user})
			assert.NilError(t, err)
			assert.Equal(t, strings.Contains(strings.Join(topicTitles(rows), ","), "deleted"), want)
		}
		counts := sectionCounts(t, f, section)
		if want {
			assert.Equal(t, counts.TopicCount, 2)
			assert.Equal(t, counts.PostCount, 3)
			assert.Equal(t, counts.LastPost.PostID, reply)
		} else {
			assert.Equal(t, counts.TopicCount, 1)
			assert.Equal(t, counts.PostCount, 1)
			assert.Equal(t, counts.LastPost.TopicID, stays)
		}
		// The moderator reads it either way and finds it in the section's list.
		h.userID = mod
		for _, page := range pages {
			h.get(t, f, page)
			assert.Equal(t, h.notFound, false)
		}
		rows, err := f.sectionTopics(context.Background(), section, 1, Viewer{ID: mod, Moderator: true})
		assert.NilError(t, err)
		assert.Equal(t, len(rows), 2)
	}

	visible(true)
	h.userID = mod
	redirectedTo(t, h.post(t, f, modURL(topic, topicDelete), url.Values{"reason": {"off topic"}}))
	visible(false)

	// The moderator reads who deleted it and why, and gets only Restore in the menu.
	h.userID = mod
	h.get(t, f, fmt.Sprintf("/forum/topic/%d", topic))
	body := string(h.page.Body)
	assert.StringContains(t, body, `class="forum-notice forum-deleted-notice"`)
	assert.StringContains(t, body, fmt.Sprintf(`<a class="forum-author-name" href="%s">mod</a>, `, userURL(mod)))
	assert.StringContains(t, body, "off topic")
	assert.StringContains(t, body, modURL(topic, topicRestore))
	assert.Equal(t, strings.Contains(body, modURL(topic, topicDelete)), false)
	// Nobody replies in it, a moderator neither.
	assert.Equal(t, h.post(t, f, fmt.Sprintf("/forum/topic/%d/reply", topic), url.Values{"body": {"text"}}).Code, http.StatusForbidden)

	redirectedTo(t, h.post(t, f, modURL(topic, topicRestore), url.Values{}))
	visible(true)
	h.userID = mod
	h.get(t, f, fmt.Sprintf("/forum/topic/%d", topic))
	assert.Equal(t, strings.Contains(string(h.page.Body), "forum-deleted-notice"), false)
	// The counters of the topic were never touched.
	got := readTopic(t, db, topic)
	assert.Equal(t, got.ReplyCount, 1)
	assert.Equal(t, *got.LastPostID, reply)
}

// The menu is the moderator's: its links follow the state of the topic.
func TestTopicModerationMenu(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	mod := newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	topic, _ := mustCreateTopic(t, f, section, alice, "title", at(1))
	target := fmt.Sprintf("/forum/topic/%d", topic)

	for _, user := range []int{0, alice} {
		h.userID = user
		h.get(t, f, target)
		assert.Equal(t, strings.Contains(string(h.page.Body), "forum-mod-menu"), false)
	}

	h.userID = mod
	h.get(t, f, target)
	body := string(h.page.Body)
	assert.StringContains(t, body, `<details class="forum-menu forum-mod-menu">`)
	for _, a := range []topicAction{topicRename, topicPin, topicClose, topicMove, topicDelete} {
		assert.StringContains(t, body, `href="`+modURL(topic, a)+`"`)
	}
	for _, a := range []topicAction{topicUnpin, topicOpen, topicRestore} {
		assert.Equal(t, strings.Contains(body, modURL(topic, a)), false)
	}

	redirectedTo(t, h.post(t, f, modURL(topic, topicPin), url.Values{}))
	redirectedTo(t, h.post(t, f, modURL(topic, topicClose), url.Values{}))
	h.get(t, f, target)
	body = string(h.page.Body)
	for _, a := range []topicAction{topicUnpin, topicOpen} {
		assert.StringContains(t, body, `href="`+modURL(topic, a)+`"`)
	}
	for _, a := range []topicAction{topicPin, topicClose} {
		assert.Equal(t, strings.Contains(body, `href="`+modURL(topic, a)+`"`), false)
	}

	// The move page offers every section, the topic's own chosen.
	h.get(t, f, modURL(topic, topicMove))
	assert.StringContains(t, string(h.page.Body), fmt.Sprintf(`<option value="%d" selected>section</option>`, section))
	assert.Equal(t, strings.Count(string(h.page.Body), "<option "), 6)
}

// A banned user reads but writes nothing: the forms of block 2 and 3 refuse them as rights.go does.
func TestBannedUserWritesNothing(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	mod := newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	topic, _ := mustCreateTopic(t, f, section, alice, "title", at(1))
	reply := mustReply(t, f, topic, alice, "reply", at(2))
	_, err := db.Exec(context.Background(), `
		INSERT INTO forum_bans (user_id, moderator_id, reason) VALUES ($1, $2, 'spam')`, alice, mod)
	assert.NilError(t, err)
	h.userID = alice

	h.get(t, f, fmt.Sprintf("/forum/topic/%d", topic))
	assert.Equal(t, h.status, http.StatusOK)
	body := string(h.page.Body)
	for _, form := range []string{`id="reply"`, "forum-edit-post", "forum-delete-post", "forum-quote-post"} {
		assert.Equal(t, strings.Contains(body, form), false)
	}
	for _, target := range []string{
		fmt.Sprintf("/forum/section/%d/new", section),
		fmt.Sprintf("/forum/topic/%d/reply", topic),
		editURL(reply),
		deleteURL(reply),
	} {
		rec := h.post(t, f, target, url.Values{"title": {"title"}, "body": {"text"}})
		assert.Equal(t, rec.Code, http.StatusForbidden)
	}
	topics, posts := countRows(t, db)
	assert.Equal(t, topics, 1)
	assert.Equal(t, posts, 2)
	got := readPost(t, db, reply)
	assert.Equal(t, got.body, "reply")
	assert.Equal(t, got.deletedAt == nil, true)
}
