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

func restoreURL(id int) string { return postURL(id) + "/restore" }

// A moderator deletes another's reply and restores it: each writes its line of the log with the
// post, its topic and the reason, and recounts the topic.
func TestModeratePost(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	mod := newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	topicID, _ := mustCreateTopic(t, f, section, alice, "topic", at(0))
	earlier := mustReply(t, f, topicID, alice, "earlier", at(1))
	last := mustReply(t, f, topicID, alice, "last", at(2))
	h.userID = mod

	// The page asks first, with a reason, and changes nothing.
	h.get(t, f, deleteURL(last))
	assert.Equal(t, h.status, http.StatusOK)
	assert.Equal(t, h.page.NoIndex, true)
	assert.StringContains(t, string(h.page.Body), `id="forum-mod-reason"`)
	assert.Equal(t, readPost(t, db, last).deletedAt == nil, true)

	f.now = func() time.Time { return at(30) }
	assert.Equal(t, redirectedTo(t, h.post(t, f, deleteURL(last), url.Values{"reason": {" spam "}})), postURL(last))
	got := readPost(t, db, last)
	assert.Equal(t, got.deletedAt.Equal(at(30)), true)
	assert.Equal(t, *got.deletedBy, mod)
	topic := readTopic(t, db, topicID)
	assert.Equal(t, topic.ReplyCount, 1)
	assert.Equal(t, *topic.LastPostID, earlier)
	assert.Equal(t, sectionCounts(t, f, section).PostCount, 2)

	log := modLog(t, db)
	assert.Equal(t, len(log), 1)
	assert.Equal(t, fmt.Sprint(log[0]), fmt.Sprint(logRow{ModeratorID: mod, Action: "post.delete", TopicID: topicID,
		PostID: last, Reason: "spam", Data: map[string]any{}}))

	h.get(t, f, restoreURL(last))
	assert.Equal(t, h.status, http.StatusOK)
	assert.Equal(t, h.page.NoIndex, true)
	assert.Equal(t, redirectedTo(t, h.post(t, f, restoreURL(last), url.Values{"reason": {"a mistake"}})), postURL(last))
	got = readPost(t, db, last)
	assert.Equal(t, got.deletedAt == nil, true)
	assert.Equal(t, got.deletedBy == nil, true)
	topic = readTopic(t, db, topicID)
	assert.Equal(t, topic.ReplyCount, 2)
	assert.Equal(t, *topic.LastPostID, last)
	assert.Equal(t, topic.LastPostAt.Equal(at(2)), true)
	counts := sectionCounts(t, f, section)
	assert.Equal(t, counts.PostCount, 3)
	assert.Equal(t, counts.LastPost.PostID, last)
	log = modLog(t, db)
	assert.Equal(t, len(log), 2)
	assert.Equal(t, fmt.Sprint(log[1]), fmt.Sprint(logRow{ModeratorID: mod, Action: "post.restore", TopicID: topicID,
		PostID: last, Reason: "a mistake", Data: map[string]any{}}))

	// A post its author deleted comes back the same way; the author's deletion is not in the log.
	h.userID = alice
	redirectedTo(t, h.post(t, f, deleteURL(earlier), nil))
	assert.Equal(t, len(modLog(t, db)), 2)
	h.userID = mod
	redirectedTo(t, h.post(t, f, restoreURL(earlier), nil))
	assert.Equal(t, readPost(t, db, earlier).deletedAt == nil, true)
	assert.Equal(t, readTopic(t, db, topicID).ReplyCount, 2)
	log = modLog(t, db)
	assert.Equal(t, len(log), 3)
	assert.Equal(t, log[2].Action, "post.restore")
	assert.Equal(t, log[2].PostID, earlier)

	// A moderator's own post is theirs to take back, as any author's: no reason, no log.
	own := mustReply(t, f, topicID, mod, "mine", at(3))
	h.get(t, f, deleteURL(own))
	assert.Equal(t, strings.Contains(string(h.page.Body), `id="forum-mod-reason"`), false)
	redirectedTo(t, h.post(t, f, deleteURL(own), nil))
	assert.Equal(t, *readPost(t, db, own).deletedBy, mod)
	assert.Equal(t, len(modLog(t, db)), 3)
}

// A reason too long gives the form back with 422 and changes nothing.
func TestModeratePostErrors(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	h.userID = newModerator(t, db, "mod")
	topicID, _ := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(0))
	reply := mustReply(t, f, topicID, alice, "reply", at(1))
	deleted := mustReply(t, f, topicID, alice, "deleted", at(2))
	deletePost(t, db, deleted)
	long := url.Values{"reason": {strings.Repeat("я", reasonMaxChars+1)}}

	for _, target := range []string{deleteURL(reply), restoreURL(deleted)} {
		h.post(t, f, target, long)
		assert.Equal(t, h.status, http.StatusUnprocessableEntity)
		page := string(h.page.Body)
		assert.StringContains(t, page, `id="forum-mod-reason-error"`)
		assert.StringContains(t, page, ">"+long.Get("reason")+"</textarea>")
	}
	assert.Equal(t, readPost(t, db, reply).deletedAt == nil, true)
	assert.Equal(t, readPost(t, db, deleted).deletedAt != nil, true)
	assert.Equal(t, len(modLog(t, db)), 0)
	// The longest reason passes, counted in characters.
	redirectedTo(t, h.post(t, f, deleteURL(reply), url.Values{"reason": {strings.Repeat("я", reasonMaxChars)}}))
}

// Only a moderator deletes another's post and restores one; the first post goes only with its
// topic. Nobody else changes anything, nothing is logged.
func TestModeratePostRefused(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	mod := newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	topicID, first := mustCreateTopic(t, f, section, alice, "topic", at(0))
	reply := mustReply(t, f, topicID, alice, "reply", at(1))
	deleted := mustReply(t, f, topicID, alice, "deleted", at(2))
	deletePost(t, db, deleted)
	gone, _ := mustCreateTopic(t, f, section, alice, "gone", at(0))
	inGone := mustReply(t, f, gone, alice, "reply", at(1))
	deletedInGone := mustReply(t, f, gone, alice, "deleted", at(2))
	deletePost(t, db, deletedInGone)
	deleteTopic(t, db, gone)

	tests := []struct {
		name   string
		viewer int
		target string
		want   int // 303 to sign in, 403, or 404 for the site's not found
	}{
		{"guest restores", 0, restoreURL(deleted), http.StatusSeeOther},
		{"member restores another's post", bob, restoreURL(deleted), http.StatusForbidden},
		{"author restores their post", alice, restoreURL(deleted), http.StatusForbidden},
		{"member restores in a deleted topic", bob, restoreURL(deletedInGone), http.StatusNotFound},
		{"moderator deletes the first post", mod, deleteURL(first), http.StatusForbidden},
		{"moderator deletes a deleted post", mod, deleteURL(deleted), http.StatusForbidden},
		{"moderator deletes in a deleted topic", mod, deleteURL(inGone), http.StatusForbidden},
		{"moderator restores a post that stands", mod, restoreURL(reply), http.StatusForbidden},
		{"moderator restores in a deleted topic", mod, restoreURL(deletedInGone), http.StatusForbidden},
		{"moderator restores no post", mod, restoreURL(999999), http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h.userID = tt.viewer
			for _, rec := range []int{h.get(t, f, tt.target).Code, h.post(t, f, tt.target, url.Values{"reason": {"why"}}).Code} {
				switch tt.want {
				case http.StatusNotFound:
					assert.Equal(t, h.notFound, true)
				case http.StatusSeeOther:
					assert.Equal(t, rec, tt.want)
					assert.Equal(t, h.status, 0)
				default:
					assert.Equal(t, rec, tt.want)
				}
			}
		})
	}
	for _, id := range []int{first, reply, inGone} {
		assert.Equal(t, readPost(t, db, id).deletedAt == nil, true)
	}
	for _, id := range []int{deleted, deletedInGone} {
		assert.Equal(t, readPost(t, db, id).deletedAt != nil, true)
	}
	assert.Equal(t, len(modLog(t, db)), 0)
}

// A moderator reads a deleted post with who deleted it, when and why; a guest and another member
// get the line without the text or the reason.
func TestDeletedPostSeenByModerator(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	mod := newModerator(t, db, "the-moderator")
	topicID, _ := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(0))
	const secret, reason = "the-secret-of-the-deleted-post", "the-reason-of-the-moderator"
	reply := mustReply(t, f, topicID, alice, secret, at(1))
	h.userID = mod
	redirectedTo(t, h.post(t, f, deleteURL(reply), url.Values{"reason": {reason}}))
	topicURL := fmt.Sprintf("/forum/topic/%d", topicID)

	h.get(t, f, topicURL)
	page := string(h.page.Body)
	cardAt := strings.Index(page, `<article class="forum-post deleted-mod" id="post-`+fmt.Sprint(reply)+`"`)
	if cardAt < 0 {
		t.Fatal("no card of the deleted post for the moderator")
	}
	card := page[cardAt : cardAt+strings.Index(page[cardAt:], "</article>")]
	assert.StringContains(t, card, secret)
	assert.StringContains(t, card, `<span class="deleted-note">`)
	assert.StringContains(t, card, "the-moderator")
	assert.StringContains(t, card, reason)
	assert.StringContains(t, card, `href="`+restoreURL(reply)+`"`)
	// The page of restoring shows the card too, without the actions.
	h.get(t, f, restoreURL(reply))
	assert.StringContains(t, string(h.page.Body), secret)

	for _, viewer := range []int{0, bob} {
		h.userID = viewer
		h.get(t, f, topicURL)
		page := string(h.page.Body)
		assert.StringContains(t, page, `<article class="forum-post deleted-stub" id="post-`+fmt.Sprint(reply)+`"`)
		for _, text := range []string{secret, reason, "deleted-mod"} {
			if strings.Contains(page, text) {
				t.Errorf("viewer %d: %q is on the page", viewer, text)
			}
		}
	}

	// Restored by the moderator, then deleted by its author: the old reason is not the author's.
	h.userID = mod
	redirectedTo(t, h.post(t, f, restoreURL(reply), nil))
	h.userID = alice
	redirectedTo(t, h.post(t, f, deleteURL(reply), nil))
	p, err := f.loadPost(context.Background(), reply, Viewer{ID: mod, Moderator: true})
	assert.NilError(t, err)
	assert.Equal(t, p.Body, secret)
	assert.Equal(t, p.DeletedByName, "alice")
	assert.Equal(t, p.DeleteReason, "")
}
