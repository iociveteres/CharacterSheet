package forum

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

// post sends the form to target as the viewer of the host; a server error fails the test.
func (h *testHost) post(t *testing.T, f *Forum, target string, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	h.err, h.status, h.page, h.notFound = nil, 0, Page{}, false
	req := httptest.NewRequest(http.MethodPost, target, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	f.Handler().ServeHTTP(rec, req)
	if h.err != nil {
		t.Fatalf("POST %s: %v", target, h.err)
	}
	return rec
}

// redirectedTo is where the answer of a form sends the browser; it fails the test unless the
// answer is 303 See Other.
func redirectedTo(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status %d, want 303", rec.Code)
	}
	return rec.Header().Get("Location")
}

func countRows(t *testing.T, db *pgxpool.Pool) (topics, posts int) {
	t.Helper()
	err := db.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM forum_topics), (SELECT count(*) FROM forum_posts)`).
		Scan(&topics, &posts)
	assert.NilError(t, err)
	return topics, posts
}

func newestPost(t *testing.T, db *pgxpool.Pool) (id, topicID, authorID int, body string) {
	t.Helper()
	err := db.QueryRow(context.Background(), `
		SELECT id, topic_id, author_id, body FROM forum_posts ORDER BY id DESC LIMIT 1`).
		Scan(&id, &topicID, &authorID, &body)
	assert.NilError(t, err)
	return id, topicID, authorID, body
}

func closeTopic(t *testing.T, db *pgxpool.Pool, topicID int) {
	t.Helper()
	_, err := db.Exec(context.Background(), `UPDATE forum_topics SET closed = true WHERE id = $1`, topicID)
	assert.NilError(t, err)
}

func TestNewTopic(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	section := newSection(t, db, "section")
	target := fmt.Sprintf("/forum/section/%d/new", section)

	h.userID = alice
	h.get(t, f, target)
	assert.Equal(t, h.status, http.StatusOK)
	assert.Equal(t, h.page.NoIndex, true)
	assert.StringContains(t, string(h.page.Body), `action="`+target+`"`)

	// The title loses its outer spaces, the body keeps what was typed.
	body := "  indented\n\n**bold**  "
	rec := h.post(t, f, target, url.Values{"title": {"  Hello there  "}, "body": {body}})
	postID, topicID, author, gotBody := newestPost(t, db)
	assert.Equal(t, redirectedTo(t, rec), postURL(postID))
	assert.Equal(t, author, alice)
	assert.Equal(t, gotBody, body)
	topic := readTopic(t, db, topicID)
	assert.Equal(t, topic.SectionID, section)
	assert.Equal(t, topic.Title, "Hello there")
	assert.Equal(t, *topic.LastPostID, postID)

	// The bounds of decision 5 pass, counted in characters, not bytes.
	rec = h.post(t, f, target, url.Values{"title": {"abc"}, "body": {"x"}})
	redirectedTo(t, rec)
	rec = h.post(t, f, target, url.Values{"title": {strings.Repeat("я", titleMaxChars)}, "body": {strings.Repeat("я", bodyMaxChars)}})
	redirectedTo(t, rec)
}

func TestNewTopicErrors(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	h.userID = forumtest.User(t, db, "alice", at(0))
	target := fmt.Sprintf("/forum/section/%d/new", newSection(t, db, "section"))

	tests := []struct {
		name, title, body string
		field             string // the field with the error
	}{
		{"blank title", "   ", "body", "title"},
		{"short title", " ab ", "body", "title"},
		{"long title", strings.Repeat("я", titleMaxChars+1), "body", "title"},
		{"blank body", "title", " \n\t\r\n ", "body"},
		{"long body", "title", strings.Repeat("я", bodyMaxChars+1), "body"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			topics, posts := countRows(t, db)
			rec := h.post(t, f, target, url.Values{"title": {tt.title}, "body": {tt.body}})
			assert.Equal(t, rec.Header().Get("Location"), "")
			assert.Equal(t, h.status, http.StatusUnprocessableEntity)
			page := string(h.page.Body)
			// The error is next to its field only, and what was typed comes back.
			for _, field := range []string{"title", "body"} {
				hasError := strings.Contains(page, `id="forum-topic-`+field+`-error"`)
				assert.Equal(t, hasError, field == tt.field)
			}
			assert.StringContains(t, page, `value="`+strings.TrimSpace(tt.title)+`"`)
			assert.StringContains(t, page, ">"+tt.body+"</textarea>")
			gotTopics, gotPosts := countRows(t, db)
			assert.Equal(t, gotTopics, topics)
			assert.Equal(t, gotPosts, posts)
		})
	}
}

func TestNewTopicRefused(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	mod := newModerator(t, db, "mod")
	var news int
	err := db.QueryRow(context.Background(), `
		INSERT INTO forum_sections (name, position, mods_only_topics) VALUES ('news', 100, true) RETURNING id`).Scan(&news)
	assert.NilError(t, err)
	questions := fmt.Sprintf("/forum/section/%d/new", newSection(t, db, "questions"))
	newsTarget := fmt.Sprintf("/forum/section/%d/new", news)
	form := url.Values{"title": {"title"}, "body": {"body"}}

	// A guest goes to sign in, from the link and from a form sent after the session ended.
	h.userID = 0
	assert.Equal(t, redirectedTo(t, h.get(t, f, questions)), "/user/login")
	assert.Equal(t, redirectedTo(t, h.post(t, f, questions, form)), "/user/login")

	// A member in a section of moderators' topics.
	h.userID = alice
	assert.Equal(t, h.get(t, f, newsTarget).Code, http.StatusForbidden)
	assert.Equal(t, h.post(t, f, newsTarget, form).Code, http.StatusForbidden)
	topics, _ := countRows(t, db)
	assert.Equal(t, topics, 0)

	h.userID = mod
	redirectedTo(t, h.post(t, f, newsTarget, form))

	h.userID = alice
	h.post(t, f, "/forum/section/999999/new", form)
	assert.Equal(t, h.notFound, true)
}

func TestReply(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	topicID, _ := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(0))
	target := fmt.Sprintf("/forum/topic/%d/reply", topicID)

	h.userID = bob
	rec := h.post(t, f, target, url.Values{"body": {"a reply"}})
	postID, gotTopic, author, body := newestPost(t, db)
	assert.Equal(t, redirectedTo(t, rec), postURL(postID))
	assert.Equal(t, gotTopic, topicID)
	assert.Equal(t, author, bob)
	assert.Equal(t, body, "a reply")
	topic := readTopic(t, db, topicID)
	assert.Equal(t, topic.ReplyCount, 1)
	assert.Equal(t, *topic.LastPostID, postID)

	// The link of the form leads to the last page of the topic.
	for i := 0; i < postsPerPage; i++ {
		mustReply(t, f, topicID, alice, "reply", at(i+1))
	}
	assert.Equal(t, redirectedTo(t, h.get(t, f, target)), fmt.Sprintf("/forum/topic/%d?page=2#reply", topicID))
}

func TestReplyErrors(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	topicID, _ := mustCreateTopic(t, f, newSection(t, db, "section"), alice, "topic", at(0))
	for i := 1; i < postsPerPage+1; i++ {
		mustReply(t, f, topicID, alice, "reply", at(i))
	}
	target := fmt.Sprintf("/forum/topic/%d/reply", topicID)
	h.userID = alice

	for _, body := range []string{"", " \n\t ", strings.Repeat("я", bodyMaxChars+1)} {
		_, posts := countRows(t, db)
		rec := h.post(t, f, target, url.Values{"body": {body}})
		assert.Equal(t, rec.Header().Get("Location"), "")
		assert.Equal(t, h.status, http.StatusUnprocessableEntity)
		// The last page of the topic, where the form is, with the error and the text.
		assert.Equal(t, h.page.Canonical, fmt.Sprintf("https://example.com/forum/topic/%d?page=2", topicID))
		page := string(h.page.Body)
		assert.StringContains(t, page, `id="forum-reply-body-error"`)
		assert.StringContains(t, page, ">"+body+"</textarea>")
		_, gotPosts := countRows(t, db)
		assert.Equal(t, gotPosts, posts)
	}
}

func TestReplyRefused(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	mod := newModerator(t, db, "mod")
	section := newSection(t, db, "section")
	open, _ := mustCreateTopic(t, f, section, alice, "open", at(0))
	closed, _ := mustCreateTopic(t, f, section, alice, "closed", at(0))
	closeTopic(t, db, closed)
	deleted, _ := mustCreateTopic(t, f, section, alice, "deleted", at(0))
	deleteTopic(t, db, deleted)
	reply := func(id int) string { return fmt.Sprintf("/forum/topic/%d/reply", id) }
	form := url.Values{"body": {"a reply"}}
	_, posts := countRows(t, db)

	h.userID = 0
	assert.Equal(t, redirectedTo(t, h.get(t, f, reply(open))), "/user/login")
	assert.Equal(t, redirectedTo(t, h.post(t, f, reply(open), form)), "/user/login")

	h.userID = alice
	assert.Equal(t, h.post(t, f, reply(closed), form).Code, http.StatusForbidden)
	h.post(t, f, reply(deleted), form)
	assert.Equal(t, h.notFound, true)
	h.post(t, f, reply(999999), form)
	assert.Equal(t, h.notFound, true)

	// A moderator replies in a closed topic, but in a deleted one nobody does.
	h.userID = mod
	assert.Equal(t, h.post(t, f, reply(deleted), form).Code, http.StatusForbidden)
	_, gotPosts := countRows(t, db)
	assert.Equal(t, gotPosts, posts)
	redirectedTo(t, h.post(t, f, reply(closed), form))
}

// TestFormsOffered: a page shows a form only to whom its address takes it, and a guest a link to
// sign in where a member could post.
func TestFormsOffered(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	alice := forumtest.User(t, db, "alice", at(0))
	var news int
	err := db.QueryRow(context.Background(), `
		INSERT INTO forum_sections (name, position, mods_only_topics) VALUES ('news', 100, true) RETURNING id`).Scan(&news)
	assert.NilError(t, err)
	questions := newSection(t, db, "questions")
	open, _ := mustCreateTopic(t, f, questions, alice, "open", at(0))
	closed, _ := mustCreateTopic(t, f, questions, alice, "closed", at(0))
	closeTopic(t, db, closed)
	long, _ := mustCreateTopic(t, f, questions, alice, "long", at(0))
	for i := 1; i < postsPerPage+1; i++ {
		mustReply(t, f, long, alice, "reply", at(i))
	}

	const newTopicLink, replyForm = `forum-new-topic"`, `/reply#reply" method="POST"`
	tests := []struct {
		name         string
		viewer       int
		target       string
		form, signIn bool
	}{
		{"member in a section", alice, fmt.Sprintf("/forum/section/%d", questions), true, false},
		{"guest in a section", 0, fmt.Sprintf("/forum/section/%d", questions), false, true},
		{"member in news", alice, fmt.Sprintf("/forum/section/%d", news), false, false},
		{"guest in news", 0, fmt.Sprintf("/forum/section/%d", news), false, false},
		{"member in a topic", alice, fmt.Sprintf("/forum/topic/%d", open), true, false},
		{"guest in a topic", 0, fmt.Sprintf("/forum/topic/%d", open), false, true},
		{"member in a closed topic", alice, fmt.Sprintf("/forum/topic/%d", closed), false, false},
		{"guest in a closed topic", 0, fmt.Sprintf("/forum/topic/%d", closed), false, false},
		{"member on a page before the last", alice, fmt.Sprintf("/forum/topic/%d", long), false, false},
		{"member on the last page", alice, fmt.Sprintf("/forum/topic/%d?page=2", long), true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h.userID = tt.viewer
			h.get(t, f, tt.target)
			assert.Equal(t, h.status, http.StatusOK)
			page := string(h.page.Body)
			form := strings.Contains(page, newTopicLink) || strings.Contains(page, replyForm)
			assert.Equal(t, form, tt.form)
			assert.Equal(t, strings.Contains(page, `forum-sign-in"`), tt.signIn)
		})
	}
}
