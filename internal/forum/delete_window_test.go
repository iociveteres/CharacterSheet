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

// banForm is the delete window's form with the box «Ban the author» ticked.
func banForm(days, reason string) url.Values {
	return url.Values{"ban": {"1"}, "duration": {days}, "reason": {reason}}
}

// The moderator's delete window bans the author of a member's post: the box, the terms with 1 day
// chosen (extras/decisions.md, 30), and one POST that deletes the post and bans with the one reason:
// two lines of the log, the ban linked to the post.
func TestDeleteAndBan(t *testing.T) {
	s := newBanScene(t)
	fixedNow(s.f, at(10))
	s.h.userID = s.mod

	s.h.get(t, s.f, deleteURL(s.reply))
	assert.Equal(t, s.h.status, http.StatusOK)
	body := string(s.h.page.Body)
	assert.StringContains(t, body, `id="forum-ban-author" name="ban" value="1">`)
	assert.Equal(t, strings.Count(body, `type="radio" name="duration"`), len(banDays))
	assert.StringContains(t, body, `value="1" checked`)
	assert.StringContains(t, body, `class="forum-delete-and-ban"`)
	assert.StringContains(t, body, `href="`+userURL(s.alice)+`"`)
	// No other posts of hers in the last day: no box for them.
	assert.Equal(t, strings.Contains(body, `name="recent"`), false)

	rec := s.h.post(t, s.f, deleteURL(s.reply), banForm("7", " spam "))
	assert.Equal(t, redirectedTo(t, rec), postURL(s.reply))
	got := readPost(t, s.db, s.reply)
	assert.Equal(t, got.deletedAt.Equal(at(10)), true)
	assert.Equal(t, *got.deletedBy, s.mod)
	assert.Equal(t, readTopic(t, s.db, s.topic).ReplyCount, 0)

	list := bans(t, s.db)
	assert.Equal(t, len(list), 1)
	b := list[0]
	assert.Equal(t, b.UserID, s.alice)
	assert.Equal(t, b.ModeratorID, s.mod)
	assert.Equal(t, b.Reason, "spam")
	assert.Equal(t, b.CreatedAt.Equal(at(10)), true)
	assert.Equal(t, b.ExpiresAt.Equal(at(10).AddDate(0, 0, 7)), true)

	log := modLog(t, s.db)
	assert.Equal(t, len(log), 2)
	assert.Equal(t, fmt.Sprint(log[0]), fmt.Sprint(logRow{ModeratorID: s.mod, Action: "post.delete", TopicID: s.topic,
		PostID: s.reply, Reason: "spam", Data: map[string]any{}}))
	assert.Equal(t, log[1].Action, string(actionBanUser))
	assert.Equal(t, log[1].UserID, s.alice)
	assert.Equal(t, log[1].PostID, s.reply)
	assert.Equal(t, log[1].TopicID, s.topic)
	assert.Equal(t, log[1].Reason, "spam")
	assert.Equal[any](t, log[1].Data["banId"], float64(b.ID))
	assert.Equal(t, log[1].Data["expiresAt"] != nil, true)
	// The list of bans finds the post by the line of the log.
	s.h.get(t, s.f, bansURL)
	assert.StringContains(t, string(s.h.page.Body), `href="`+postURL(s.reply)+`"`)

	s.h.userID = s.alice
	v, _ := viewerOf(t, s.f)
	assert.Equal(t, v.Banned(), true)
	assert.Equal(t, v.Ban.ID, b.ID)
}

// Without the box the window deletes as before: one line, no ban, whatever term the form sends.
func TestDeleteWithoutBan(t *testing.T) {
	s := newBanScene(t)
	s.h.userID = s.mod
	redirectedTo(t, s.h.post(t, s.f, deleteURL(s.reply), url.Values{"duration": {"7"}}))
	assert.Equal(t, readPost(t, s.db, s.reply).deletedAt != nil, true)
	assert.Equal(t, len(bans(t, s.db)), 0)
	log := modLog(t, s.db)
	assert.Equal(t, len(log), 1)
	assert.Equal(t, log[0].Action, string(actionDeletePost))
}

// A ban needs a reason, its user reads it, and a term the window offers; a reason too long fails
// as for a deletion. The window comes back with 422, the box still ticked and the input, and
// nothing is written: the post stays.
func TestDeleteAndBanErrors(t *testing.T) {
	s := newBanScene(t)
	s.h.userID = s.mod
	for _, form := range []url.Values{
		banForm("7", "  "),
		banForm("7", strings.Repeat("я", reasonMaxChars+1)),
		banForm("3", "spam"),
		{"ban": {"1"}, "reason": {"spam"}},
	} {
		rec := s.h.post(t, s.f, deleteURL(s.reply), form)
		assert.Equal(t, rec.Code, http.StatusOK)
		assert.Equal(t, s.h.status, http.StatusUnprocessableEntity)
		body := string(s.h.page.Body)
		assert.StringContains(t, body, `aria-invalid="true"`)
		assert.StringContains(t, body, `id="forum-ban-author" name="ban" value="1" checked>`)
	}
	assert.Equal(t, readPost(t, s.db, s.reply).deletedAt == nil, true)
	assert.Equal(t, len(bans(t, s.db)), 0)
	assert.Equal(t, len(modLog(t, s.db)), 0)
}

// An author under a ban gets no second one: the window says until when, by whom and why instead of
// the box, and a form that sends the box anyway (sent twice, or after another moderator's ban)
// deletes the post and leaves the ban as it was.
func TestDeleteWindowOfBannedAuthor(t *testing.T) {
	s := newBanScene(t)
	other := mustReply(t, s.f, s.topic, s.alice, "more", at(3))
	fixedNow(s.f, at(10))
	s.h.userID = s.mod
	redirectedTo(t, s.h.post(t, s.f, deleteURL(s.reply), banForm("1", "spam")))

	s.h.get(t, s.f, deleteURL(other))
	body := string(s.h.page.Body)
	assert.StringContains(t, body, `class="meta forum-delete-banned"`)
	assert.StringContains(t, body, `href="`+userURL(s.mod)+`"`)
	assert.Equal(t, strings.Contains(body, `id="forum-ban-author"`), false)
	assert.Equal(t, strings.Contains(body, `class="forum-delete-and-ban"`), false)

	fixedNow(s.f, at(20))
	redirectedTo(t, s.h.post(t, s.f, deleteURL(other), banForm("0", "again")))
	assert.Equal(t, readPost(t, s.db, other).deletedAt != nil, true)
	list := bans(t, s.db)
	assert.Equal(t, len(list), 1)
	assert.Equal(t, list[0].LiftedAt == nil, true)
	assert.Equal(t, list[0].ExpiresAt.Equal(at(10).AddDate(0, 0, 1)), true)
	log := modLog(t, s.db)
	assert.Equal(t, len(log), 3)
	assert.Equal(t, log[2].Action, string(actionDeletePost))
	assert.Equal(t, log[2].PostID, other)
}

// The block «Author» is a moderator's over a member's post: another moderator's post and one's own
// have none, and the server refuses its boxes there with 403 before anything changes; so it does
// for a member deleting their own post. The post has no link of its own to a ban any more, and the
// old address of the ban page leads to the delete window.
func TestDeleteWindowAuthorBlockRefused(t *testing.T) {
	s := newBanScene(t)
	other := newModerator(t, s.db, "other mod")
	modPost := mustReply(t, s.f, s.topic, other, "a moderator's reply", at(3))
	ownPost := mustReply(t, s.f, s.topic, s.mod, "own reply", at(4))
	aliceOwn := mustReply(t, s.f, s.topic, s.alice, "alice again", at(5))

	s.h.userID = s.mod
	for _, p := range []int{modPost, ownPost} {
		s.h.get(t, s.f, deleteURL(p))
		assert.Equal(t, s.h.status, http.StatusOK)
		body := string(s.h.page.Body)
		assert.Equal(t, strings.Contains(body, "forum-delete-author"), false)
		assert.Equal(t, strings.Contains(body, `name="ban"`), false)
		for _, form := range []url.Values{banForm("1", "spam"), {"recent": {"1"}, "reason": {"spam"}}} {
			assert.Equal(t, s.h.post(t, s.f, deleteURL(p), form).Code, http.StatusForbidden)
			assert.Equal(t, readPost(t, s.db, p).deletedAt == nil, true)
		}
	}
	s.h.userID = s.alice
	assert.Equal(t, s.h.post(t, s.f, deleteURL(aliceOwn), banForm("1", "spam")).Code, http.StatusForbidden)
	assert.Equal(t, readPost(t, s.db, aliceOwn).deletedAt == nil, true)
	s.h.userID = 0
	assert.Equal(t, redirectedTo(t, s.h.post(t, s.f, deleteURL(s.reply), banForm("1", "spam"))), "/user/login")
	assert.Equal(t, len(bans(t, s.db)), 0)
	assert.Equal(t, len(modLog(t, s.db)), 0)

	s.h.userID = s.mod
	s.h.get(t, s.f, fmt.Sprintf("/forum/topic/%d", s.topic))
	assert.Equal(t, strings.Contains(string(s.h.page.Body), `/ban"`), false)
	rec := s.h.get(t, s.f, postURL(s.reply)+"/ban")
	assert.Equal(t, rec.Code, http.StatusMovedPermanently)
	assert.Equal(t, rec.Header().Get("Location"), deleteURL(s.reply))
	// Its form had a POST of its own; that is no address any more.
	s.h.post(t, s.f, postURL(s.reply)+"/ban", banForm("1", "spam"))
	assert.Equal(t, s.h.notFound, true)
	assert.Equal(t, len(bans(t, s.db)), 0)
}

// «And their other posts of 24 hours» deletes the author's posts of the last day that stand, with
// the window's reason: in this topic and others, but never another's post, an older one, a first
// post (it goes only with its topic) or one in a deleted topic. Each topic it touched is recounted,
// one line of the log names the posts, and the moderator reads the reason on each.
func TestDeleteRecent(t *testing.T) {
	s := newBanScene(t)
	now := at(3 * 24 * 60)
	hoursAgo := func(h float64) time.Time { return now.Add(-time.Duration(h * float64(time.Hour))) }
	bob := forumtest.User(t, s.db, "bob", at(0))
	other, _ := mustCreateTopic(t, s.f, s.section, bob, "other", hoursAgo(30))
	gone, _ := mustCreateTopic(t, s.f, s.section, bob, "gone", hoursAgo(30))

	window := mustReply(t, s.f, s.topic, s.alice, "spam", hoursAgo(2))
	here := mustReply(t, s.f, s.topic, s.alice, "spam here", hoursAgo(1))
	there := mustReply(t, s.f, other, s.alice, "spam there", hoursAgo(23.5))
	bobs := mustReply(t, s.f, other, bob, "bob's answer", hoursAgo(0.5))
	older := mustReply(t, s.f, other, s.alice, "a day ago", hoursAgo(24))
	_, first := mustCreateTopic(t, s.f, s.section, s.alice, "her topic", hoursAgo(3))
	inGone := mustReply(t, s.f, gone, s.alice, "in a deleted topic", hoursAgo(4))
	deleteTopic(t, s.db, gone)
	selfDeleted := mustReply(t, s.f, other, s.alice, "taken back", hoursAgo(5))
	deletePost(t, s.db, selfDeleted)
	selfDeletedAt := readPost(t, s.db, selfDeleted).deletedAt

	fixedNow(s.f, now)
	notified := len(notices(t, s.db, s.alice))
	s.h.userID = s.mod
	p, err := s.f.loadPost(context.Background(), window, Viewer{ID: s.mod, Moderator: true})
	assert.NilError(t, err)
	n, topics, err := s.f.recentPosts(context.Background(), p, now)
	assert.NilError(t, err)
	assert.Equal(t, n, 2)
	// Her topic of the day, which the box leaves: the block says how many.
	assert.Equal(t, topics, 1)
	s.h.get(t, s.f, deleteURL(window))
	assert.StringContains(t, string(s.h.page.Body), `name="recent" value="1">`)
	assert.StringContains(t, string(s.h.page.Body), `class="meta forum-delete-topics"`)

	rec := s.h.post(t, s.f, deleteURL(window), url.Values{"recent": {"1"}, "reason": {"spam"}})
	assert.Equal(t, redirectedTo(t, rec), postURL(window))
	for _, id := range []int{window, here, there} {
		got := readPost(t, s.db, id)
		assert.Equal(t, got.deletedAt != nil && got.deletedAt.Equal(now), true)
		assert.Equal(t, *got.deletedBy, s.mod)
	}
	for _, id := range []int{bobs, older, first, inGone, s.reply} {
		assert.Equal(t, readPost(t, s.db, id).deletedAt == nil, true)
	}
	assert.Equal(t, readPost(t, s.db, selfDeleted).deletedAt.Equal(*selfDeletedAt), true)

	topic := readTopic(t, s.db, s.topic)
	assert.Equal(t, topic.ReplyCount, 1)
	assert.Equal(t, *topic.LastPostID, s.reply)
	topic = readTopic(t, s.db, other)
	assert.Equal(t, topic.ReplyCount, 2)
	// The last by id: posts here were made out of the order of their times.
	assert.Equal(t, *topic.LastPostID, older)

	log := modLog(t, s.db)
	assert.Equal(t, len(log), 2)
	assert.Equal(t, log[0].Action, string(actionDeletePost))
	assert.Equal(t, fmt.Sprint(log[1]), fmt.Sprint(logRow{ModeratorID: s.mod, Action: "post.delete_recent", UserID: s.alice,
		Reason: "spam", Data: map[string]any{"posts": []any{float64(here), float64(there)}}}))
	assert.Equal(t, len(bans(t, s.db)), 0)
	// The author hears of the post of the window only.
	list := notices(t, s.db, s.alice)
	assert.Equal(t, len(list), notified+1)
	assert.Equal(t, list[len(list)-1].PostID, window)

	mod := Viewer{ID: s.mod, Moderator: true}
	for _, id := range []int{here, there} {
		got, err := s.f.loadPost(context.Background(), id, mod)
		assert.NilError(t, err)
		assert.Equal(t, got.DeleteReason, "spam")
	}
	s.h.get(t, s.f, modLogURL+fmt.Sprintf("?user=%d", s.alice))
	assert.StringContains(t, string(s.h.page.Body), fmt.Sprintf(`id="log-%d"`, 2))

	// Restored, a post no longer shows the reason of that deletion.
	redirectedTo(t, s.h.post(t, s.f, restoreURL(here), nil))
	s.h.userID = s.alice
	redirectedTo(t, s.h.post(t, s.f, deleteURL(here), nil))
	got, err := s.f.loadPost(context.Background(), here, mod)
	assert.NilError(t, err)
	assert.Equal(t, got.DeleteReason, "")
}

// Delete, the author's last day and a ban go in one POST: three lines, in that order, one reason.
func TestDeleteRecentAndBan(t *testing.T) {
	s := newBanScene(t)
	now := at(60)
	more := mustReply(t, s.f, s.topic, s.alice, "more", at(30))
	fixedNow(s.f, now)
	s.h.userID = s.mod
	form := banForm("30", "spam")
	form.Set("recent", "1")
	redirectedTo(t, s.h.post(t, s.f, deleteURL(s.reply), form))
	assert.Equal(t, readPost(t, s.db, more).deletedAt != nil, true)
	var actions []string
	for _, l := range modLog(t, s.db) {
		assert.Equal(t, l.Reason, "spam")
		actions = append(actions, l.Action)
	}
	assert.Equal(t, strings.Join(actions, " "), "post.delete post.delete_recent user.ban")
	assert.Equal(t, len(bans(t, s.db)), 1)
}
