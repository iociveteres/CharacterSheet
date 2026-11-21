package forum

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

// notice is a row of forum_notifications as the tests compare it.
type notice struct {
	ID      int
	Kind    string
	TopicID int
	PostID  int
	Count   int
	Params  map[string]any
	Read    bool
}

// String leaves out the parameters and the id: what a test of who gets what compares.
func (n notice) String() string {
	return fmt.Sprintf("%s topic=%d post=%d count=%d read=%v", n.Kind, n.TopicID, n.PostID, n.Count, n.Read)
}

// notices are the notifications of the user in the order they were made.
func notices(t *testing.T, db *pgxpool.Pool, userID int) []notice {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT id, kind, COALESCE(topic_id, 0), COALESCE(post_id, 0), count, params, read_at IS NOT NULL
		FROM forum_notifications WHERE user_id = $1 ORDER BY id`, userID)
	assert.NilError(t, err)
	defer rows.Close()
	var list []notice
	for rows.Next() {
		var n notice
		assert.NilError(t, rows.Scan(&n.ID, &n.Kind, &n.TopicID, &n.PostID, &n.Count, &n.Params, &n.Read))
		list = append(list, n)
	}
	assert.NilError(t, rows.Err())
	return list
}

// noticeList is the notifications of the user as one string, one per line.
func noticeList(t *testing.T, db *pgxpool.Pool, userID int) string {
	t.Helper()
	var lines []string
	for _, n := range notices(t, db, userID) {
		lines = append(lines, n.String())
	}
	return strings.Join(lines, "\n")
}

// readNotices marks every notification of the user read, as «Mark all as read» of their page does.
func readNotices(t *testing.T, db *pgxpool.Pool, userID int) {
	t.Helper()
	_, err := db.Exec(context.Background(), `
		UPDATE forum_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, userID)
	assert.NilError(t, err)
}

func subscribed(t *testing.T, db *pgxpool.Pool, userID, topicID int) bool {
	t.Helper()
	var ok bool
	err := db.QueryRow(context.Background(), `
		SELECT EXISTS (SELECT 1 FROM forum_subscriptions WHERE user_id = $1 AND topic_id = $2)`, userID, topicID).Scan(&ok)
	assert.NilError(t, err)
	return ok
}

// quoteOf is the head of a quote of the post as the quote button writes it, under the given name.
func quoteOf(name string, postID int) string {
	return fmt.Sprintf("> **%s** [wrote in #2](/forum/post/%d):\n> the words\n\n", name, postID)
}

// notifyScene is a topic of alice in a section, with users around it.
type notifyScene struct {
	db                     *pgxpool.Pool
	h                      *testHost
	f                      *Forum
	section, topic, first  int
	alice, bob, carol, mod int
}

func newNotifyScene(t *testing.T) notifyScene {
	db := forumtest.NewDB(t)
	h := &testHost{}
	s := notifyScene{db: db, h: h, f: newTestForum(t, db, h)}
	s.alice = forumtest.User(t, db, "alice", at(0))
	s.bob = forumtest.User(t, db, "bob", at(0))
	s.carol = forumtest.User(t, db, "carol", at(0))
	s.mod = newModerator(t, db, "mod")
	s.section = newSection(t, db, "section")
	s.topic, s.first = mustCreateTopic(t, s.f, s.section, s.alice, "title", at(1))
	return s
}

func (s notifyScene) subscribe(t *testing.T, userID int) {
	t.Helper()
	assert.NilError(t, subscribe(context.Background(), s.db, userID, s.topic, at(1)))
}

// The creator of a topic is subscribed to it; a reply subscribes nobody (decision 11, changed on
// 2026-11-19).
func TestSubscriptionOfCreatorOnly(t *testing.T) {
	s := newNotifyScene(t)
	assert.Equal(t, subscribed(t, s.db, s.alice, s.topic), true)
	mustReply(t, s.f, s.topic, s.bob, "a reply", at(2))
	assert.Equal(t, subscribed(t, s.db, s.bob, s.topic), false)
}

// Replies gather into one unread notification of the topic: the count grows, the link stays on the
// first. Once it is read, the next reply makes a new one.
func TestRepliesGatherIntoOneNotification(t *testing.T) {
	s := newNotifyScene(t)
	first := mustReply(t, s.f, s.topic, s.bob, "one", at(2))
	mustReply(t, s.f, s.topic, s.carol, "two", at(3))
	mustReply(t, s.f, s.topic, s.bob, "three", at(4))
	assert.Equal(t, noticeList(t, s.db, s.alice), fmt.Sprintf("replies topic=%d post=%d count=3 read=false", s.topic, first))
	assert.Equal(t, notices(t, s.db, s.alice)[0].Params["title"], "title")

	readNotices(t, s.db, s.alice)
	next := mustReply(t, s.f, s.topic, s.carol, "four", at(5))
	assert.Equal(t, noticeList(t, s.db, s.alice), fmt.Sprintf(
		"replies topic=%d post=%d count=3 read=true\nreplies topic=%d post=%d count=1 read=false", s.topic, first, s.topic, next))

	// The unique index holds one unread row per user and topic whatever the code does.
	_, err := s.db.Exec(context.Background(), `
		INSERT INTO forum_notifications (user_id, kind, topic_id, post_id) VALUES ($1, 'replies', $2, $3)`,
		s.alice, s.topic, next)
	assert.NotNilError(t, err)
}

// Replies go to the subscribers but their author; a member who replied without subscribing, and one
// who unsubscribed, get none.
func TestRepliesGoToSubscribersOnly(t *testing.T) {
	s := newNotifyScene(t)
	s.subscribe(t, s.carol)
	mustReply(t, s.f, s.topic, s.bob, "bob replies", at(2))
	mustReply(t, s.f, s.topic, s.alice, "alice replies", at(3))

	assert.Equal(t, len(notices(t, s.db, s.bob)), 0)
	assert.Equal(t, notices(t, s.db, s.carol)[0].Count, 2)
	// Alice's own reply adds nothing to hers.
	assert.Equal(t, notices(t, s.db, s.alice)[0].Count, 1)

	s.h.userID = s.carol
	redirectedTo(t, s.h.post(t, s.f, fmt.Sprintf("/forum/topic/%d/unsubscribe", s.topic), url.Values{}))
	mustReply(t, s.f, s.topic, s.bob, "again", at(4))
	assert.Equal(t, notices(t, s.db, s.carol)[0].Count, 2)
}

// A quote notifies the author of the quoted post of this topic, subscribed or not; the post names
// the author, whatever name the head shows. A subscriber who is quoted gets the quote only.
func TestQuoteNotifiesItsAuthor(t *testing.T) {
	s := newNotifyScene(t)
	bobs := mustReply(t, s.f, s.topic, s.bob, "bob's words", at(2))

	// Carol quotes bob, who is not subscribed, and alice, who is.
	quoting := mustReply(t, s.f, s.topic, s.carol, quoteOf("bob", bobs)+quoteOf("alice", s.first)+"both of you", at(3))
	assert.Equal(t, noticeList(t, s.db, s.bob), fmt.Sprintf("quote topic=%d post=%d count=1 read=false", s.topic, quoting))
	got := notices(t, s.db, s.bob)[0].Params
	assert.Equal(t, got["title"], "title")
	assert.Equal(t, got["name"], "carol")
	// Alice's replies notification of bob's post stays at 1: carol's post came to her as a quote.
	assert.Equal(t, noticeList(t, s.db, s.alice), fmt.Sprintf(
		"replies topic=%d post=%d count=1 read=false\nquote topic=%d post=%d count=1 read=false", s.topic, bobs, s.topic, quoting))

	// A head with another's name notifies the author of the post it links to.
	readNotices(t, s.db, s.bob)
	forged := mustReply(t, s.f, s.topic, s.carol, quoteOf("alice", bobs), at(4))
	assert.Equal(t, notices(t, s.db, s.bob)[1].String(), fmt.Sprintf("quote topic=%d post=%d count=1 read=false", s.topic, forged))

	// Quoting oneself notifies nobody.
	readNotices(t, s.db, s.bob)
	mustReply(t, s.f, s.topic, s.bob, quoteOf("bob", bobs), at(5))
	assert.Equal(t, len(notices(t, s.db, s.bob)), 2)
}

// A quote of a post of another topic notifies nobody, and one post notifies five quoted authors at
// most, the first five it quotes (decision 12).
func TestQuoteLimits(t *testing.T) {
	s := newNotifyScene(t)
	_, otherFirst := mustCreateTopic(t, s.f, s.section, s.bob, "other", at(1))
	mustReply(t, s.f, s.topic, s.carol, quoteOf("bob", otherFirst), at(2))
	assert.Equal(t, len(notices(t, s.db, s.bob)), 0)

	var users []int
	var body strings.Builder
	for i := range 6 {
		u := forumtest.User(t, s.db, fmt.Sprintf("user %d", i), at(0))
		users = append(users, u)
		p := mustReply(t, s.f, s.topic, u, "words", at(3+i))
		body.WriteString(quoteOf("someone", p))
	}
	mustReply(t, s.f, s.topic, s.carol, body.String(), at(10))
	for i, u := range users {
		var quotes int
		for _, n := range notices(t, s.db, u) {
			if n.Kind == string(notifyQuote) {
				quotes++
			}
		}
		want := 0
		if i < maxQuoteNotifications {
			want = 1
		}
		assert.Equal(t, quotes, want)
	}
}

func TestQuotedPosts(t *testing.T) {
	tests := []struct {
		name, body string
		want       []int
	}{
		{"head", quoteOf("bob", 12), []int{12}},
		{"hand-typed head", "> [Bob wrote](/forum/post/7):\n> words", []int{7}},
		{"each once, in order", quoteOf("a", 9) + quoteOf("b", 3) + quoteOf("a", 9), []int{9, 3}},
		{"nested", "> [A](/forum/post/1):\n> > [B](/forum/post/2):\n> > inner\n>\n> outer", []int{1, 2}},
		{"not the first line", "> words\n> [A](/forum/post/1):", []int{}},
		{"no colon", "> [A](/forum/post/1)\n> words", []int{}},
		{"another site", "> [A](https://example.com/forum/post/1):\n> words", []int{}},
		{"a link outside a quote", "[A](/forum/post/1):", []int{}},
		{"past int4", "> [A](/forum/post/99999999999):\n> words", []int{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, fmt.Sprint(quotedPosts(tt.body)), fmt.Sprint(tt.want))
		})
	}
}

// Each moderator action on another's content that notifies (notifiedActions) gives its author one
// notification with the title at the time, the reason and what else the action has; pinning
// notifies nobody, and neither does a moderator's action on their own content.
func TestModeratorActionsNotifyTheAuthor(t *testing.T) {
	s := newNotifyScene(t)
	other := newSection(t, s.db, "other")
	fixedNow(s.f, at(10))
	reply := mustReply(t, s.f, s.topic, s.bob, "bob's reply", at(2))
	// The delete window bans: each ban deletes a post of its own first, which notifies too.
	spam := mustReply(t, s.f, s.topic, s.bob, "spam", at(3))
	more := mustReply(t, s.f, s.topic, s.bob, "more spam", at(4))
	readNotices(t, s.db, s.alice)
	s.h.userID = s.mod
	post := func(target string, form url.Values) {
		t.Helper()
		redirectedTo(t, s.h.post(t, s.f, target, form))
	}
	lastBan := func() int {
		t.Helper()
		var id int
		assert.NilError(t, s.db.QueryRow(context.Background(), `SELECT max(id) FROM forum_bans`).Scan(&id))
		return id
	}
	weekLater := at(10).AddDate(0, 0, 7).Format(time.RFC3339)

	// In order: each step leaves the topic as the next one needs it. params are all the parameters
	// of the notification, as JSON gives them back.
	steps := []struct {
		name     string
		target   func() string
		form     url.Values
		user     int
		want     string
		params   map[string]any
		notifies bool
		// earlier is how many notifications the step gives before the one it checks.
		earlier int
	}{
		{"delete post", func() string { return postURL(reply) + "/delete" }, url.Values{"reason": {"rude"}}, s.bob,
			fmt.Sprintf("post.delete topic=%d post=%d", s.topic, reply), map[string]any{"title": "title", "reason": "rude"}, true, 0},
		{"restore post", func() string { return postURL(reply) + "/restore" }, url.Values{}, s.bob,
			fmt.Sprintf("post.restore topic=%d post=%d", s.topic, reply), map[string]any{"title": "title"}, true, 0},
		{"rename", func() string { return modURL(s.topic, topicRename) }, url.Values{"title": {"renamed"}}, s.alice,
			fmt.Sprintf("topic.rename topic=%d post=0", s.topic), map[string]any{"title": "renamed", "oldTitle": "title"}, true, 0},
		{"pin", func() string { return modURL(s.topic, topicPin) }, url.Values{}, s.alice, "", nil, false, 0},
		{"close", func() string { return modURL(s.topic, topicClose) }, url.Values{"reason": {"done"}}, s.alice,
			fmt.Sprintf("topic.close topic=%d post=0", s.topic), map[string]any{"title": "renamed", "reason": "done"}, true, 0},
		{"open", func() string { return modURL(s.topic, topicOpen) }, url.Values{}, s.alice,
			fmt.Sprintf("topic.open topic=%d post=0", s.topic), map[string]any{"title": "renamed"}, true, 0},
		{"move", func() string { return modURL(s.topic, topicMove) }, url.Values{"section": {fmt.Sprint(other)}}, s.alice,
			fmt.Sprintf("topic.move topic=%d post=0", s.topic), map[string]any{"title": "renamed", "section": "other"}, true, 0},
		{"delete topic", func() string { return modURL(s.topic, topicDelete) }, url.Values{"reason": {"gone"}}, s.alice,
			fmt.Sprintf("topic.delete topic=%d post=0", s.topic), map[string]any{"title": "renamed", "reason": "gone"}, true, 0},
		{"restore topic", func() string { return modURL(s.topic, topicRestore) }, url.Values{}, s.alice,
			fmt.Sprintf("topic.restore topic=%d post=0", s.topic), map[string]any{"title": "renamed"}, true, 0},
		{"ban for a week", func() string { return deleteURL(spam) }, url.Values{"ban": {"1"}, "duration": {"7"}, "reason": {"spam"}}, s.bob,
			fmt.Sprintf("user.ban topic=%d post=%d", s.topic, spam),
			map[string]any{"title": "renamed", "reason": "spam", "expiresAt": weekLater}, true, 1},
		{"lift the ban", func() string { return liftURL(lastBan()) }, url.Values{}, s.bob,
			"user.unban topic=0 post=0", map[string]any{}, true, 0},
		{"ban until lifted", func() string { return deleteURL(more) }, url.Values{"ban": {"1"}, "duration": {"0"}, "reason": {"again"}}, s.bob,
			fmt.Sprintf("user.ban topic=%d post=%d", s.topic, more),
			map[string]any{"title": "renamed", "reason": "again", "expiresAt": nil}, true, 1},
	}
	for _, step := range steps {
		before := len(notices(t, s.db, step.user))
		post(step.target(), step.form)
		list := notices(t, s.db, step.user)
		if !step.notifies {
			if len(list) != before {
				t.Errorf("%s: %d notifications, want %d", step.name, len(list), before)
			}
			continue
		}
		if len(list) != before+1+step.earlier {
			t.Fatalf("%s: %d notifications, want %d", step.name, len(list), before+1+step.earlier)
		}
		n := list[len(list)-1]
		assert.Equal(t, n.String(), step.want+" count=1 read=false")
		got, _ := json.Marshal(n.Params)
		want, _ := json.Marshal(step.params)
		if string(got) != string(want) {
			t.Errorf("%s: params %s, want %s", step.name, got, want)
		}
	}

	// The moderator's own topic and post: no notification to the moderator.
	modTopic, _ := mustCreateTopic(t, s.f, s.section, s.mod, "mod's", at(5))
	modReply := mustReply(t, s.f, modTopic, s.mod, "mod's reply", at(6))
	for _, a := range []topicAction{topicRename, topicClose, topicOpen, topicMove, topicDelete, topicRestore} {
		post(modURL(modTopic, a), url.Values{"title": {"mod's renamed"}, "section": {fmt.Sprint(other)}})
	}
	post(postURL(modReply)+"/delete", url.Values{})
	post(postURL(modReply)+"/restore", url.Values{})
	assert.Equal(t, len(notices(t, s.db, s.mod)), 0)
}

// A deleted account gets no notification: neither of a quote of its post nor of a moderator's
// action on its post or topic.
func TestDeletedUserGetsNoNotifications(t *testing.T) {
	s := newNotifyScene(t)
	bobs := mustReply(t, s.f, s.topic, s.bob, "bob's words", at(2))
	bobsTopic, _ := mustCreateTopic(t, s.f, s.section, s.bob, "bob's topic", at(2))
	_, err := s.db.Exec(context.Background(), `UPDATE users SET status = 'deleted', name = '' WHERE id = $1`, s.bob)
	assert.NilError(t, err)
	// Wipe deletes the notifications a tombstone had (forum.WipeUser).
	_, err = s.db.Exec(context.Background(), `DELETE FROM forum_notifications WHERE user_id = $1`, s.bob)
	assert.NilError(t, err)

	mustReply(t, s.f, s.topic, s.carol, quoteOf("bob", bobs)+quoteOf("alice", s.first), at(3))
	s.h.userID = s.mod
	redirectedTo(t, s.h.post(t, s.f, postURL(bobs)+"/delete", url.Values{"reason": {"old"}}))
	redirectedTo(t, s.h.post(t, s.f, modURL(bobsTopic, topicClose), url.Values{}))
	assert.Equal(t, len(notices(t, s.db, s.bob)), 0)

	// The quote still notifies the living author it quotes.
	var quotes int
	for _, n := range notices(t, s.db, s.alice) {
		if n.Kind == string(notifyQuote) {
			quotes++
		}
	}
	assert.Equal(t, quotes, 1)
}

// A user's read notifications older than 90 days go when a new one comes to them; unread ones of
// any age and newer read ones stay, and so do other users'.
func TestOldReadNotificationsGo(t *testing.T) {
	s := newNotifyScene(t)
	ctx := context.Background()
	now := at(0).AddDate(0, 6, 0)
	old := now.Add(-notificationsKeptFor - time.Hour)
	recent := now.Add(-notificationsKeptFor + time.Hour)
	insert := func(userID int, updated time.Time, read bool) int {
		t.Helper()
		var id int
		err := s.db.QueryRow(ctx, `
			INSERT INTO forum_notifications (user_id, kind, topic_id, created_at, updated_at, read_at)
			VALUES ($1, 'topic.close', $2, $3, $3, CASE WHEN $4 THEN $3::timestamptz END) RETURNING id`,
			userID, s.topic, updated, read).Scan(&id)
		assert.NilError(t, err)
		return id
	}
	insert(s.alice, old, true)
	oldUnread := insert(s.alice, old, false)
	recentRead := insert(s.alice, recent, true)
	othersOld := insert(s.bob, old, true)

	mustReply(t, s.f, s.topic, s.carol, "a reply", now)
	var ids []int
	for _, n := range notices(t, s.db, s.alice) {
		ids = append(ids, n.ID)
	}
	assert.Equal(t, fmt.Sprint(ids[:2]), fmt.Sprint([]int{oldUnread, recentRead}))
	assert.Equal(t, len(ids), 3)
	assert.Equal(t, notices(t, s.db, s.bob)[0].ID, othersOld)
}

func TestUnreadNotifications(t *testing.T) {
	s := newNotifyScene(t)
	ctx := context.Background()
	other, _ := mustCreateTopic(t, s.f, s.section, s.alice, "other", at(1))
	mustReply(t, s.f, s.topic, s.bob, "one", at(2))
	mustReply(t, s.f, s.topic, s.bob, "two", at(3))
	mustReply(t, s.f, other, s.bob, "three", at(4))
	n, err := s.f.UnreadNotifications(ctx, s.alice)
	assert.NilError(t, err)
	assert.Equal(t, n, 2)
	readNotices(t, s.db, s.alice)
	n, err = s.f.UnreadNotifications(ctx, s.alice)
	assert.NilError(t, err)
	assert.Equal(t, n, 0)
}

// The button of a topic head subscribes and unsubscribes and goes back to the page it was on; a
// guest and a banned user get no button and 403, a deleted topic is not found but by a moderator,
// who may not subscribe to it.
func TestSubscribeButton(t *testing.T) {
	s := newNotifyScene(t)
	topicURL := fmt.Sprintf("/forum/topic/%d", s.topic)
	button := func(userID int) string {
		t.Helper()
		s.h.userID = userID
		s.h.get(t, s.f, topicURL)
		assert.Equal(t, s.h.status, http.StatusOK)
		body := string(s.h.page.Body)
		switch {
		case strings.Contains(body, `action="`+topicURL+`/unsubscribe"`):
			assert.StringContains(t, body, `forum-subscribe on" aria-pressed="true"`)
			return "on"
		case strings.Contains(body, `action="`+topicURL+`/subscribe"`):
			assert.StringContains(t, body, `forum-subscribe" aria-pressed="false"`)
			return "off"
		}
		return "none"
	}
	assert.Equal(t, button(s.alice), "on")
	assert.Equal(t, button(s.bob), "off")
	assert.Equal(t, button(0), "none")

	s.h.userID = s.bob
	rec := s.h.post(t, s.f, topicURL+"/subscribe", url.Values{"page": {"3"}})
	assert.Equal(t, redirectedTo(t, rec), topicURL+"?page=3")
	assert.Equal(t, subscribed(t, s.db, s.bob, s.topic), true)
	assert.Equal(t, button(s.bob), "on")
	// Twice is the same; a page that is no page goes to the first.
	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, topicURL+"/subscribe", url.Values{"page": {"x"}})), topicURL)
	redirectedTo(t, s.h.post(t, s.f, topicURL+"/unsubscribe", url.Values{}))
	assert.Equal(t, subscribed(t, s.db, s.bob, s.topic), false)
	assert.Equal(t, button(s.bob), "off")

	s.h.userID = 0
	assert.Equal(t, s.h.post(t, s.f, topicURL+"/subscribe", url.Values{}).Code, http.StatusForbidden)

	insertBan(t, s.db, s.carol, s.mod)
	assert.Equal(t, button(s.carol), "none")
	s.h.userID = s.carol
	assert.Equal(t, s.h.post(t, s.f, topicURL+"/subscribe", url.Values{}).Code, http.StatusForbidden)
	assert.Equal(t, subscribed(t, s.db, s.carol, s.topic), false)

	assert.Equal(t, button(s.mod), "off")
	deleteTopic(t, s.db, s.topic)
	s.h.userID = s.bob
	s.h.post(t, s.f, topicURL+"/subscribe", url.Values{})
	assert.Equal(t, s.h.notFound, true)
	assert.Equal(t, button(s.mod), "none")
	s.h.userID = s.mod
	assert.Equal(t, s.h.post(t, s.f, topicURL+"/subscribe", url.Values{}).Code, http.StatusForbidden)
}
