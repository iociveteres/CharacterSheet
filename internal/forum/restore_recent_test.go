package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
)

// restoreAllURL is the button «Restore all» of the line logID of the log.
func restoreAllURL(logID int) string { return fmt.Sprintf("%s/%d/restore", modLogURL, logID) }

// «Restore all» on the line of a deleted day brings back only what that line deleted and is still
// deleted by it: a post restored since stays as it is, one restored and deleted again since keeps
// its new deletion, one in a topic deleted since waits for its topic. The topics are recounted, the
// log gets its line, the author a notification; with nothing left, a press writes nothing and the
// button is gone from the log.
func TestRestoreRecent(t *testing.T) {
	s := newBanScene(t)
	now := at(60)
	other, _ := mustCreateTopic(t, s.f, s.section, s.mod, "other", at(0))
	closing, _ := mustCreateTopic(t, s.f, s.section, s.mod, "closing", at(0))
	restoredSince := mustReply(t, s.f, s.topic, s.alice, "a", at(10))
	deletedAgain := mustReply(t, s.f, s.topic, s.alice, "b", at(11))
	back := mustReply(t, s.f, other, s.alice, "c", at(12))
	inDeletedTopic := mustReply(t, s.f, closing, s.alice, "d", at(13))
	fixedNow(s.f, now)
	s.h.userID = s.mod
	redirectedTo(t, s.h.post(t, s.f, deleteURL(s.reply), url.Values{"recent": {"1"}, "reason": {"spam"}}))
	log := modLog(t, s.db)
	assert.Equal(t, len(log), 2)
	entry := 2
	assert.Equal(t, log[1].Action, string(actionDeleteRecent))

	s.h.get(t, s.f, modLogURL)
	assert.StringContains(t, string(s.h.page.Body), `action="`+restoreAllURL(entry)+`"`)
	assert.Equal(t, strings.Count(string(s.h.page.Body), `class="forum-log-restore"`), 1)

	fixedNow(s.f, at(70))
	redirectedTo(t, s.h.post(t, s.f, restoreURL(restoredSince), nil))
	redirectedTo(t, s.h.post(t, s.f, restoreURL(deletedAgain), nil))
	s.h.userID = s.alice
	redirectedTo(t, s.h.post(t, s.f, deleteURL(deletedAgain), nil))
	deleteTopic(t, s.db, closing)
	notified := len(notices(t, s.db, s.alice))

	fixedNow(s.f, at(80))
	s.h.userID = s.mod
	backTo := modLogURL + fmt.Sprintf("?user=%d", s.alice)
	rec := s.h.post(t, s.f, restoreAllURL(entry), url.Values{"back": {backTo}})
	assert.Equal(t, redirectedTo(t, rec), backTo+fmt.Sprintf("#log-%d", entry))

	assert.Equal(t, readPost(t, s.db, back).deletedAt == nil, true)
	assert.Equal(t, readPost(t, s.db, restoredSince).deletedAt == nil, true)
	again := readPost(t, s.db, deletedAgain)
	assert.Equal(t, again.deletedAt.Equal(at(70)), true)
	assert.Equal(t, *again.deletedBy, s.alice)
	assert.Equal(t, readPost(t, s.db, inDeletedTopic).deletedAt.Equal(now), true)
	// The post of the window has its own line and its own «Restore».
	assert.Equal(t, readPost(t, s.db, s.reply).deletedAt != nil, true)
	topic := readTopic(t, s.db, other)
	assert.Equal(t, topic.ReplyCount, 1)
	assert.Equal(t, *topic.LastPostID, back)

	log = modLog(t, s.db)
	assert.Equal(t, len(log), 5)
	assert.Equal(t, fmt.Sprint(log[4]), fmt.Sprint(logRow{ModeratorID: s.mod, Action: "post.restore_recent", UserID: s.alice,
		Data: map[string]any{"entry": float64(entry), "posts": []any{float64(back)}}}))
	list := notices(t, s.db, s.alice)
	assert.Equal(t, len(list), notified+1)
	n := list[len(list)-1]
	assert.Equal(t, n.Kind, string(actionRestoreRecent))
	assert.Equal(t, fmt.Sprint(n.Params), "map[count:1]")
	s.h.userID = s.alice
	s.h.get(t, s.f, "/forum/notifications")
	assert.StringContains(t, string(s.h.page.Body), `href="`+userURL(s.alice)+`"`)
	// Back and then taken back by its author, a post no longer shows the reason of that day.
	redirectedTo(t, s.h.post(t, s.f, deleteURL(back), nil))
	got, err := s.f.loadPost(context.Background(), back, Viewer{ID: s.mod, Moderator: true})
	assert.NilError(t, err)
	assert.Equal(t, got.DeleteReason, "")
	got, err = s.f.loadPost(context.Background(), inDeletedTopic, Viewer{ID: s.mod, Moderator: true})
	assert.NilError(t, err)
	assert.Equal(t, got.DeleteReason, "spam")

	// Its topic restored, the last post waiting comes back with a second press, and a back that is
	// not the log goes to the log. Then nothing is left: no line, no button.
	_, err = s.db.Exec(context.Background(), `UPDATE forum_topics SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`, closing)
	assert.NilError(t, err)
	s.h.userID = s.mod
	s.h.get(t, s.f, modLogURL)
	assert.StringContains(t, string(s.h.page.Body), `action="`+restoreAllURL(entry)+`"`)
	rec = s.h.post(t, s.f, restoreAllURL(entry), url.Values{"back": {"https://example.com/"}})
	assert.Equal(t, redirectedTo(t, rec), modLogURL+fmt.Sprintf("#log-%d", entry))
	assert.Equal(t, readPost(t, s.db, inDeletedTopic).deletedAt == nil, true)
	assert.Equal(t, readTopic(t, s.db, closing).ReplyCount, 1)
	assert.Equal(t, len(modLog(t, s.db)), 6)
	redirectedTo(t, s.h.post(t, s.f, restoreAllURL(entry), nil))
	assert.Equal(t, len(modLog(t, s.db)), 6)
	s.h.get(t, s.f, modLogURL)
	assert.Equal(t, strings.Contains(string(s.h.page.Body), `class="forum-log-restore"`), false)
}

// Only a moderator restores a day, and only from a line that deleted one: a guest goes to sign in,
// a member gets 403, another line of the log and no line are not found.
func TestRestoreRecentRefused(t *testing.T) {
	s := newBanScene(t)
	fixedNow(s.f, at(60))
	more := mustReply(t, s.f, s.topic, s.alice, "more", at(10))
	s.h.userID = s.mod
	redirectedTo(t, s.h.post(t, s.f, deleteURL(s.reply), url.Values{"recent": {"1"}}))
	bob := forumtest.User(t, s.db, "bob", at(0))

	s.h.userID = 0
	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, restoreAllURL(2), nil)), "/user/login")
	s.h.userID = bob
	assert.Equal(t, s.h.post(t, s.f, restoreAllURL(2), nil).Code, http.StatusForbidden)
	s.h.userID = s.mod
	for _, id := range []int{1, 99} {
		s.h.post(t, s.f, restoreAllURL(id), nil)
		assert.Equal(t, s.h.notFound, true)
	}
	assert.Equal(t, readPost(t, s.db, more).deletedAt != nil, true)
	assert.Equal(t, len(modLog(t, s.db)), 2)
}

// The old address of the ban page of a deleted post leads to its author's page, where the ban is;
// of a post that stands, and of a post in a deleted topic, to its delete window.
func TestOldBanPageOfDeletedPost(t *testing.T) {
	s := newBanScene(t)
	gone := mustReply(t, s.f, s.topic, s.alice, "gone", at(3))
	deletePost(t, s.db, gone)
	s.h.userID = s.mod
	rec := s.h.get(t, s.f, postURL(gone)+"/ban")
	assert.Equal(t, rec.Code, http.StatusMovedPermanently)
	assert.Equal(t, rec.Header().Get("Location"), userURL(s.alice))
	deleteTopic(t, s.db, s.topic)
	rec = s.h.get(t, s.f, postURL(gone)+"/ban")
	assert.Equal(t, rec.Header().Get("Location"), deleteURL(gone))
	s.h.get(t, s.f, postURL(9999)+"/ban")
	assert.Equal(t, s.h.notFound, true)
}
