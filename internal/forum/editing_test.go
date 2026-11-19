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
	"github.com/jackc/pgx/v5/pgxpool"
)

// postRow is what the tests read back of a post after a form.
type postRow struct {
	body      string
	editedAt  *time.Time
	deletedAt *time.Time
	deletedBy *int
}

func readPost(t *testing.T, db *pgxpool.Pool, id int) postRow {
	t.Helper()
	var p postRow
	err := db.QueryRow(context.Background(), `
		SELECT body, edited_at, deleted_at, deleted_by FROM forum_posts WHERE id = $1`, id).
		Scan(&p.body, &p.editedAt, &p.deletedAt, &p.deletedBy)
	assert.NilError(t, err)
	return p
}

func editURL(id int) string   { return postURL(id) + "/edit" }
func deleteURL(id int) string { return postURL(id) + "/delete" }

func TestEditPost(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	topicID, first := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(0))
	reply := mustReply(t, f, topicID, alice, "a reply", at(1))
	h.userID = alice

	h.get(t, f, editURL(reply))
	assert.Equal(t, h.status, http.StatusOK)
	assert.Equal(t, h.page.NoIndex, true)
	page := string(h.page.Body)
	assert.StringContains(t, page, `action="`+editURL(reply)+`"`)
	assert.StringContains(t, page, ">a reply</textarea>")

	// The text is kept as typed and the post is marked edited at the time of the form.
	f.now = func() time.Time { return at(10) }
	body := "  indented\n\n**edited**  "
	assert.Equal(t, redirectedTo(t, h.post(t, f, editURL(reply), url.Values{"body": {body}})), postURL(reply))
	got := readPost(t, db, reply)
	assert.Equal(t, got.body, body)
	assert.Equal(t, got.editedAt.Equal(at(10)), true)

	// The same text again changes nothing, not even the mark.
	f.now = func() time.Time { return at(20) }
	redirectedTo(t, h.post(t, f, editURL(reply), url.Values{"body": {body}}))
	assert.Equal(t, readPost(t, db, reply).editedAt.Equal(at(10)), true)

	// The topic shows the mark on the edited post only.
	h.get(t, f, fmt.Sprintf("/forum/topic/%d", topicID))
	assert.Equal(t, strings.Count(string(h.page.Body), `<span class="edited">`), 1)

	// Of the first post only the text changes: a title sent with it is not the topic's.
	redirectedTo(t, h.post(t, f, editURL(first), url.Values{"title": {"new title"}, "body": {"new first post"}}))
	assert.Equal(t, readPost(t, db, first).body, "new first post")
	assert.Equal(t, readTopic(t, db, topicID).Title, "topic")
}

func TestEditPostErrors(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	topicID, _ := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(0))
	reply := mustReply(t, f, topicID, alice, "a reply", at(1))
	h.userID = alice

	for _, body := range []string{"", " \n\t ", strings.Repeat("я", bodyMaxChars+1)} {
		rec := h.post(t, f, editURL(reply), url.Values{"body": {body}})
		assert.Equal(t, rec.Header().Get("Location"), "")
		assert.Equal(t, h.status, http.StatusUnprocessableEntity)
		page := string(h.page.Body)
		assert.StringContains(t, page, `id="forum-edit-body-error"`)
		assert.StringContains(t, page, ">"+body+"</textarea>")
		got := readPost(t, db, reply)
		assert.Equal(t, got.body, "a reply")
		assert.Equal(t, got.editedAt == nil, true)
	}
	// The longest text passes, counted in characters.
	redirectedTo(t, h.post(t, f, editURL(reply), url.Values{"body": {strings.Repeat("я", bodyMaxChars)}}))
}

// TestChangePostRefused: who may not edit or delete a post, from the form's link or from a form
// the page did not offer.
func TestChangePostRefused(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	mod := newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	open, first := mustCreateTopic(t, f, section, alice, "open", at(0))
	reply := mustReply(t, f, open, alice, "a reply", at(1))
	deleted := mustReply(t, f, open, alice, "deleted", at(2))
	deletePost(t, db, deleted)
	closed, _ := mustCreateTopic(t, f, section, alice, "closed", at(0))
	inClosed := mustReply(t, f, closed, alice, "a reply", at(1))
	closeTopic(t, db, closed)
	gone, _ := mustCreateTopic(t, f, section, alice, "gone", at(0))
	inGone := mustReply(t, f, gone, alice, "a reply", at(1))
	deleteTopic(t, db, gone)

	edit := url.Values{"body": {"changed"}}
	tests := []struct {
		name   string
		viewer int
		target string
		want   int // 303 to sign in, 403, or 404 for the site's not found
	}{
		{"guest edits", 0, editURL(reply), http.StatusSeeOther},
		{"guest deletes", 0, deleteURL(reply), http.StatusSeeOther},
		{"member edits another's post", bob, editURL(reply), http.StatusForbidden},
		{"member deletes another's post", bob, deleteURL(reply), http.StatusForbidden},
		{"moderator edits another's post", mod, editURL(reply), http.StatusForbidden},
		{"moderator deletes another's post", mod, deleteURL(reply), http.StatusForbidden},
		{"author deletes the first post", alice, deleteURL(first), http.StatusForbidden},
		{"author edits a deleted post", alice, editURL(deleted), http.StatusForbidden},
		{"author deletes a deleted post", alice, deleteURL(deleted), http.StatusForbidden},
		{"author edits in a closed topic", alice, editURL(inClosed), http.StatusForbidden},
		{"author deletes in a closed topic", alice, deleteURL(inClosed), http.StatusForbidden},
		{"author edits in a deleted topic", alice, editURL(inGone), http.StatusNotFound},
		{"author deletes in a deleted topic", alice, deleteURL(inGone), http.StatusNotFound},
		{"author edits no post", alice, editURL(999999), http.StatusNotFound},
		{"author deletes no post", alice, deleteURL(999999), http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h.userID = tt.viewer
			for _, rec := range []int{h.get(t, f, tt.target).Code, h.post(t, f, tt.target, edit).Code} {
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
	// Nothing changed.
	for _, id := range []int{first, reply, inClosed, inGone} {
		got := readPost(t, db, id)
		assert.Equal(t, got.editedAt == nil, true)
		assert.Equal(t, got.deletedAt == nil, true)
	}
}

func TestDeletePost(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	topicID, _ := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(0))
	earlier := mustReply(t, f, topicID, alice, "earlier", at(1))
	last := mustReply(t, f, topicID, alice, "last", at(2))
	h.userID = alice

	// The page asks first and changes nothing.
	h.get(t, f, deleteURL(last))
	assert.Equal(t, h.status, http.StatusOK)
	assert.Equal(t, h.page.NoIndex, true)
	assert.StringContains(t, string(h.page.Body), `action="`+deleteURL(last)+`"`)
	assert.Equal(t, readPost(t, db, last).deletedAt == nil, true)

	// The form deletes softly, says by whom and when, and recounts the topic.
	f.now = func() time.Time { return at(30) }
	assert.Equal(t, redirectedTo(t, h.post(t, f, deleteURL(last), nil)), postURL(last))
	got := readPost(t, db, last)
	assert.Equal(t, got.body, "last")
	assert.Equal(t, got.deletedAt.Equal(at(30)), true)
	assert.Equal(t, *got.deletedBy, alice)
	topic := readTopic(t, db, topicID)
	assert.Equal(t, topic.ReplyCount, 1)
	assert.Equal(t, *topic.LastPostID, earlier)
	assert.Equal(t, topic.LastPostAt.Equal(at(1)), true)

	// The link of the deleted post still leads to its place, where the topic shows a line for it.
	h.get(t, f, postURL(last))
	h.get(t, f, fmt.Sprintf("/forum/topic/%d", topicID))
	page := string(h.page.Body)
	stubAt := strings.Index(page, `<article class="forum-post deleted-stub" id="post-`+fmt.Sprint(last)+`"`)
	if stubAt < 0 {
		t.Fatal("no line in the place of the deleted post")
	}
	// The line keeps the author and the time of writing.
	stub := page[stubAt : stubAt+strings.Index(page[stubAt:], "</article>")]
	assert.StringContains(t, stub, `<span class="forum-author-name">alice</span>`)
	assert.StringContains(t, stub, `<time datetime="`+at(2).UTC().Format(time.RFC3339)+`"`)
}

// TestDeletedPostTextHidden: the text of a deleted post reaches neither a guest nor another member,
// nor its author: not on the topic page, not in its description, not on the pages of the post.
// Block 5 shows it to moderators.
func TestDeletedPostTextHidden(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	section := newSection(t, db, "section")
	const secret = "the-secret-of-the-deleted-post"
	topicID, _ := mustCreateTopic(t, f, section, alice, "topic", at(0))
	reply := mustReply(t, f, topicID, alice, secret, at(1))
	h.userID = alice
	redirectedTo(t, h.post(t, f, deleteURL(reply), nil))
	// A first post deleted (block 5 does it) leaves the description to the title.
	firstSecret, firstPost, err := f.createTopic(context.Background(), section, alice, "other", secret, at(2))
	assert.NilError(t, err)
	deletePost(t, db, firstPost)

	for _, viewer := range []int{0, bob, alice} {
		h.userID = viewer
		for _, target := range []string{
			fmt.Sprintf("/forum/topic/%d", topicID),
			fmt.Sprintf("/forum/topic/%d", firstSecret),
			editURL(reply), deleteURL(reply),
		} {
			rec := h.get(t, f, target)
			for _, text := range []string{string(h.page.Body), h.page.Description, h.page.Title, rec.Body.String()} {
				if strings.Contains(text, secret) {
					t.Errorf("viewer %d, %s: the deleted text is on the page", viewer, target)
				}
			}
		}
	}

	// loadPost, which the pages of a single post read (and the quote of session B will), never
	// carries the text either.
	p, err := f.loadPost(context.Background(), reply)
	assert.NilError(t, err)
	assert.Equal(t, p.Body, "")
}

// TestPostActionsOffered: under a post only the actions the viewer may take (design/decisions.md,
// 8), by the same rules the handlers ask.
func TestPostActionsOffered(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	mod := newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	open, _ := mustCreateTopic(t, f, section, alice, "open", at(0))
	mustReply(t, f, open, alice, "a reply", at(1))
	closed, _ := mustCreateTopic(t, f, section, alice, "closed", at(0))
	mustReply(t, f, closed, alice, "a reply", at(1))
	closeTopic(t, db, closed)

	const editLink, deleteLink = `forum-edit-post"`, `forum-delete-post"`
	tests := []struct {
		name          string
		viewer, topic int
		edit, delete  int // links on the page: the first post and the reply are alice's
	}{
		{"author", alice, open, 2, 1},
		{"author in a closed topic", alice, closed, 0, 0},
		{"another member", bob, open, 0, 0},
		{"moderator", mod, open, 0, 0},
		{"guest", 0, open, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h.userID = tt.viewer
			h.get(t, f, fmt.Sprintf("/forum/topic/%d", tt.topic))
			page := string(h.page.Body)
			assert.Equal(t, strings.Count(page, editLink), tt.edit)
			assert.Equal(t, strings.Count(page, deleteLink), tt.delete)
			assert.Equal(t, strings.Count(page, `class="forum-post-actions"`), max(tt.edit, tt.delete))
		})
	}
}
