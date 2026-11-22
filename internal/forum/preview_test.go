package forum

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
)

// TestPreviewTabs: the Text / Preview tabs of the new topic, reply and edit forms send the form
// back on the other tab with the text, write nothing and do not spend the limit of how often one
// writes.
func TestPreviewTabs(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	section := newSection(t, db, "section")
	topicID, _ := mustCreateTopic(t, f, section, alice, "topic", at(0))
	reply := mustReply(t, f, topicID, alice, "the reply as it was", at(1))
	h.userID = alice
	// The limit of replies is spent: the tabs still answer.
	for i := range repliesPerMinute {
		mustReply(t, f, topicID, alice, "spent", f.now().Add(-time.Duration(i)*time.Second))
	}

	const body = "**bold** words\n\nsecond paragraph"
	forms := []struct {
		name, target, field string
		values              url.Values
	}{
		{"new topic", fmt.Sprintf("/forum/section/%d/new", section), "forum-topic-body", url.Values{"title": {"a title"}}},
		{"reply", fmt.Sprintf("/forum/topic/%d/reply", topicID), "forum-reply-body", url.Values{}},
		{"edit", editURL(reply), "forum-edit-body", url.Values{}},
	}
	for _, form := range forms {
		t.Run(form.name, func(t *testing.T) {
			topics, posts := countRows(t, db)
			values := url.Values{"body": {body}}
			for k, v := range form.values {
				values[k] = v
			}

			values.Set("preview", "1")
			rec := h.post(t, f, form.target, values)
			assert.Equal(t, rec.Header().Get("Location"), "")
			assert.Equal(t, h.status, http.StatusOK)
			assert.Equal(t, h.page.NoIndex, true)
			page := string(h.page.Body)
			// The body rendered in the field's place, the text in a hidden field.
			assert.StringContains(t, page, `id="`+form.field+`-preview"`)
			assert.StringContains(t, page, "<strong>bold</strong>")
			assert.Equal(t, strings.Contains(page, `<textarea id="`+form.field+`"`), false)
			assert.StringContains(t, page, `<input type="hidden" name="body" value="**bold** words`+"\n\nsecond paragraph"+`">`)
			assert.StringContains(t, page, `name="write"`)
			if form.values.Has("title") {
				assert.StringContains(t, page, `value="a title"`)
			}

			values.Del("preview")
			values.Set("write", "1")
			h.post(t, f, form.target, values)
			assert.Equal(t, h.status, http.StatusOK)
			page = string(h.page.Body)
			assert.StringContains(t, page, `<textarea id="`+form.field+`"`)
			assert.StringContains(t, page, ">**bold** words\n\nsecond paragraph</textarea>")
			assert.Equal(t, strings.Contains(page, `-preview"`), false)
			assert.StringContains(t, page, `name="preview"`)

			// Nothing written.
			gotTopics, gotPosts := countRows(t, db)
			assert.Equal(t, gotTopics, topics)
			assert.Equal(t, gotPosts, posts)
			got := readPost(t, db, reply)
			assert.Equal(t, got.body, "the reply as it was")
			assert.Equal(t, got.editedAt == nil, true)
		})
	}

	t.Run("too long", func(t *testing.T) {
		for _, form := range forms {
			values := url.Values{"body": {strings.Repeat("я", bodyMaxChars+1)}, "preview": {"1"}}
			h.post(t, f, form.target, values)
			assert.Equal(t, h.status, http.StatusUnprocessableEntity)
			page := string(h.page.Body)
			// Back on the Text tab with the error under the field.
			assert.StringContains(t, page, `id="`+form.field+`-error"`)
			assert.Equal(t, strings.Contains(page, `-preview"`), false)
		}
	})
}

// TestPreviewFragment: the address of the script of block 7 renders the body alone, for a signed-in
// viewer and a body within the length. The csrf_token is the app's: TestForumPostWithoutCSRFToken.
func TestPreviewFragment(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	topics, posts := countRows(t, db)

	rec := h.post(t, f, "/forum/preview", url.Values{"body": {"**bold**"}})
	assert.Equal(t, rec.Code, http.StatusForbidden)
	assert.Equal(t, strings.Contains(rec.Body.String(), "<strong>"), false)

	h.userID = alice
	rec = h.post(t, f, "/forum/preview", url.Values{"body": {"**bold** <b>\n\n> **a** [w](/forum/post/1):"}})
	assert.Equal(t, rec.Code, http.StatusOK)
	assert.Equal(t, rec.Header().Get("Content-Type"), "text/html; charset=utf-8")
	assert.Equal(t, rec.Header().Get("Cache-Control"), "no-store")
	html := rec.Body.String()
	assert.Equal(t, strings.HasPrefix(html, "<p><strong>bold</strong> &lt;b&gt;</p>"), true)
	assert.StringContains(t, html, `<span class="quote-head">`)
	// The fragment alone, without the page around it.
	assert.Equal(t, h.status, 0)

	rec = h.post(t, f, "/forum/preview", url.Values{"body": {strings.Repeat("я", bodyMaxChars)}})
	assert.Equal(t, rec.Code, http.StatusOK)
	rec = h.post(t, f, "/forum/preview", url.Values{"body": {strings.Repeat("я", bodyMaxChars+1)}})
	assert.Equal(t, rec.Code, http.StatusUnprocessableEntity)

	gotTopics, gotPosts := countRows(t, db)
	assert.Equal(t, gotTopics, topics)
	assert.Equal(t, gotPosts, posts)
}
