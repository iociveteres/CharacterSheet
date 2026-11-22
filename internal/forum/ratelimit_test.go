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
)

// now of the limit tests: ten days into the tests' forum, far from at(0).
var limitNow = at(10 * 24 * 60)

func TestReplyLimit(t *testing.T) {
	db := forumtest.NewDB(t)
	f := newTestForum(t, db, &testHost{})
	ctx := context.Background()
	mod := newModerator(t, db, "mod")
	topicID, _ := mustCreateTopic(t, f, newSection(t, db, "section"), mod, "topic", at(0))
	sec := func(s int) time.Time { return limitNow.Add(time.Duration(s) * time.Second) }
	user := func(name string, registered time.Time) Viewer {
		return Viewer{ID: forumtest.User(t, db, name, registered), RegisteredAt: registered}
	}
	nextAt := func(v Viewer, now time.Time) time.Time {
		t.Helper()
		next, err := f.nextReplyAt(ctx, v, now)
		assert.NilError(t, err)
		return next
	}

	// Five replies a minute: the oldest of the last five leaves the window a minute after it was
	// written, and a reply exactly a minute old is out of it.
	old := user("old", at(0))
	for _, s := range []int{-60, -50, -40, -30, -20} {
		mustReply(t, f, topicID, old.ID, "reply", sec(s))
	}
	assert.Equal(t, nextAt(old, sec(-1)).Equal(sec(0)), true)
	assert.Equal(t, nextAt(old, sec(0)).IsZero(), true)

	// A day younger account: one reply a minute.
	young := user("young", limitNow.Add(-24*time.Hour+time.Second))
	mustReply(t, f, topicID, young.ID, "reply", sec(-30))
	assert.Equal(t, nextAt(young, sec(0)).Equal(sec(30)), true)
	assert.Equal(t, nextAt(young, sec(30)).IsZero(), true)

	// An account exactly a day old has the full limit.
	dayOld := user("day old", limitNow.Add(-24*time.Hour))
	mustReply(t, f, topicID, dayOld.ID, "reply", sec(-30))
	assert.Equal(t, nextAt(dayOld, sec(0)).IsZero(), true)

	// A deleted reply counts: deleting gives no room to write more.
	deleter := user("deleter", limitNow.Add(-time.Hour))
	deletePost(t, db, mustReply(t, f, topicID, deleter.ID, "reply", sec(-30)))
	assert.Equal(t, nextAt(deleter, sec(0)).Equal(sec(30)), true)

	// The first post of a topic is the topic's: a young account replies right after starting one.
	starter := user("starter", limitNow.Add(-time.Hour))
	mustCreateTopic(t, f, newSection(t, db, "other"), starter.ID, "started", sec(-10))
	assert.Equal(t, nextAt(starter, sec(0)).IsZero(), true)

	// Moderators have no limit.
	moderator := Viewer{ID: mod, RegisteredAt: limitNow, Moderator: true}
	for s := -10; s < 0; s++ {
		mustReply(t, f, topicID, mod, "reply", sec(s))
	}
	assert.Equal(t, nextAt(moderator, sec(0)).IsZero(), true)
}

func TestTopicLimit(t *testing.T) {
	db := forumtest.NewDB(t)
	f := newTestForum(t, db, &testHost{})
	ctx := context.Background()
	section := newSection(t, db, "section")
	minute := func(m int) time.Time { return limitNow.Add(time.Duration(m) * time.Minute) }
	user := func(name string, registered time.Time) Viewer {
		return Viewer{ID: forumtest.User(t, db, name, registered), RegisteredAt: registered}
	}
	nextAt := func(v Viewer, now time.Time) time.Time {
		t.Helper()
		next, err := f.nextTopicAt(ctx, v, now)
		assert.NilError(t, err)
		return next
	}

	// Five topics an hour, with the boundary of the window.
	old := user("old", at(0))
	for _, m := range []int{-60, -50, -40, -30, -20} {
		mustCreateTopic(t, f, section, old.ID, "topic", minute(m))
	}
	assert.Equal(t, nextAt(old, minute(-1)).Equal(minute(0)), true)
	assert.Equal(t, nextAt(old, minute(0)).IsZero(), true)

	// A young account: two an hour; a deleted topic counts.
	young := user("young", limitNow.Add(-time.Hour))
	mustCreateTopic(t, f, section, young.ID, "topic", minute(-50))
	deleted, _ := mustCreateTopic(t, f, section, young.ID, "topic", minute(-40))
	deleteTopic(t, db, deleted)
	assert.Equal(t, nextAt(young, minute(0)).Equal(minute(10)), true)

	// An account a day old has the full limit.
	dayOld := user("day old", limitNow.Add(-24*time.Hour))
	mustCreateTopic(t, f, section, dayOld.ID, "topic", minute(-50))
	mustCreateTopic(t, f, section, dayOld.ID, "topic", minute(-40))
	assert.Equal(t, nextAt(dayOld, minute(0)).IsZero(), true)

	// Replies are not topics: a young account at its reply limit may still start a topic.
	replier := user("replier", limitNow.Add(-time.Hour))
	topicID, _ := mustCreateTopic(t, f, section, old.ID, "to reply in", minute(-90))
	mustReply(t, f, topicID, replier.ID, "reply", minute(0).Add(-time.Second))
	assert.Equal(t, nextAt(replier, minute(0)).IsZero(), true)
}

// TestLimitedForms: a form over the limit comes back with its text, the error and 429, and writes
// nothing.
func TestLimitedForms(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	f.now = func() time.Time { return limitNow }
	section := newSection(t, db, "section")
	h.userID = forumtest.User(t, db, "young", limitNow.Add(-time.Hour))
	topicID, _ := mustCreateTopic(t, f, section, h.userID, "topic", limitNow.Add(-time.Minute))
	mustCreateTopic(t, f, section, h.userID, "topic", limitNow.Add(-time.Minute))
	mustReply(t, f, topicID, h.userID, "reply", limitNow.Add(-time.Second))
	topics, posts := countRows(t, db)

	h.post(t, f, fmt.Sprintf("/forum/topic/%d/reply", topicID), url.Values{"body": {"one more"}})
	assert.Equal(t, h.status, http.StatusTooManyRequests)
	page := string(h.page.Body)
	assert.StringContains(t, page, `class="error forum-form-error"`)
	assert.StringContains(t, page, ">one more</textarea>")

	h.post(t, f, fmt.Sprintf("/forum/section/%d/new", section), url.Values{"title": {"third"}, "body": {"one more"}})
	assert.Equal(t, h.status, http.StatusTooManyRequests)
	page = string(h.page.Body)
	assert.StringContains(t, page, `class="error forum-form-error"`)
	assert.StringContains(t, page, `value="third"`)
	assert.StringContains(t, page, ">one more</textarea>")

	gotTopics, gotPosts := countRows(t, db)
	assert.Equal(t, gotTopics, topics)
	assert.Equal(t, gotPosts, posts)

	// A form with an error of its own shows that error, not the limit.
	h.post(t, f, fmt.Sprintf("/forum/topic/%d/reply", topicID), url.Values{"body": {" "}})
	assert.Equal(t, h.status, http.StatusUnprocessableEntity)
	assert.Equal(t, strings.Contains(string(h.page.Body), `forum-form-error"`), false)
}

// The wait is told in seconds under a minute and in minutes above, rounded up.
func TestWaitUnit(t *testing.T) {
	for _, tt := range []struct {
		wait    time.Duration
		count   int
		seconds bool
	}{
		{time.Second / 2, 1, true},
		{59 * time.Second, 59, true},
		{time.Minute, 1, false},
		{time.Minute + time.Second, 2, false},
		{59*time.Minute + 30*time.Second, 60, false},
	} {
		count, seconds := waitUnit(tt.wait)
		if count != tt.count || seconds != tt.seconds {
			t.Errorf("waitUnit(%v) = %d %v, want %d %v", tt.wait, count, seconds, tt.count, tt.seconds)
		}
	}
}
