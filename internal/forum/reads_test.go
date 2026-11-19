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
	"github.com/jackc/pgx/v5/pgxpool"
)

// unread is which topics of the section page are unread by the user (0 is a guest).
func unread(t *testing.T, f *Forum, sectionID, userID int) map[int]bool {
	t.Helper()
	ctx := context.Background()
	var v Viewer
	if userID != 0 {
		var err error
		v, err = f.loadViewer(ctx, userID)
		assert.NilError(t, err)
	}
	rows, err := f.sectionTopics(ctx, sectionID, 1, v)
	assert.NilError(t, err)
	got := map[int]bool{}
	for _, r := range rows {
		got[r.ID] = r.Unread
	}
	return got
}

// sectionUnread is whether the forum home marks the section as having something unread for the user.
func sectionUnread(t *testing.T, f *Forum, sectionID, userID int) bool {
	t.Helper()
	ctx := context.Background()
	v, err := f.loadViewer(ctx, userID)
	assert.NilError(t, err)
	sections, err := f.sections(ctx, v)
	assert.NilError(t, err)
	for _, s := range sections {
		if s.ID == sectionID {
			return s.Unread
		}
	}
	t.Fatalf("no section %d on the home", sectionID)
	return false
}

func readMark(t *testing.T, db *pgxpool.Pool, userID, topicID int) int {
	t.Helper()
	var id int
	err := db.QueryRow(context.Background(), `
		SELECT COALESCE((SELECT last_read_post_id FROM forum_topic_reads WHERE user_id = $1 AND topic_id = $2), 0)`,
		userID, topicID).Scan(&id)
	assert.NilError(t, err)
	return id
}

// longTopic is a topic of 45 posts, three pages; posts[i] is the id of post #i+1.
func longTopic(t *testing.T, f *Forum, sectionID, authorID int) (topicID int, posts []int) {
	t.Helper()
	topicID, first := mustCreateTopic(t, f, sectionID, authorID, "long", at(1))
	posts = []int{first}
	for i := 2; i <= 45; i++ {
		posts = append(posts, mustReply(t, f, topicID, authorID, fmt.Sprintf("post %d", i), at(i)))
	}
	return topicID, posts
}

// Opening a page of a topic reads it up to the last post of that page, never back.
func TestReadTopicOnOpen(t *testing.T) {
	db := forumtest.NewDB(t)
	host := &testHost{}
	f := newTestForum(t, db, host)
	author := forumtest.User(t, db, "author", at(0))
	reader := forumtest.User(t, db, "reader", at(0))
	section := newSection(t, db, "section")
	topic, posts := longTopic(t, f, section, author)
	path := fmt.Sprintf("/forum/topic/%d", topic)

	open := func(viewer int, target string) {
		t.Helper()
		host.userID = viewer
		host.get(t, f, target)
		assert.Equal(t, host.found(t, target), true)
	}

	// The first page does not read the second.
	open(reader, path)
	assert.Equal(t, readMark(t, db, reader, topic), posts[19])
	assert.Equal(t, unread(t, f, section, reader)[topic], true)

	open(reader, path+"?page=2")
	assert.Equal(t, readMark(t, db, reader, topic), posts[39])
	// Back to the first page: the mark stays.
	open(reader, path)
	assert.Equal(t, readMark(t, db, reader, topic), posts[39])

	open(reader, path+"?page=3")
	assert.Equal(t, readMark(t, db, reader, topic), posts[44])
	assert.Equal(t, unread(t, f, section, reader)[topic], false)

	// A guest writes nothing.
	var marks int
	count := func() int {
		t.Helper()
		assert.NilError(t, db.QueryRow(context.Background(), `SELECT count(*) FROM forum_topic_reads`).Scan(&marks))
		return marks
	}
	before := count()
	open(0, path+"?page=3")
	assert.Equal(t, count(), before)
	assert.Equal(t, len(host.logged), 0)
}

// A mark that cannot be written goes to the log; the page is served.
func TestReadTopicFailureServesPage(t *testing.T) {
	db := forumtest.NewDB(t)
	host := &testHost{}
	f := newTestForum(t, db, host)
	author := forumtest.User(t, db, "author", at(0))
	reader := forumtest.User(t, db, "reader", at(0))
	topic, _ := mustCreateTopic(t, f, newSection(t, db, "section"), author, "topic", at(1))
	_, err := db.Exec(context.Background(), `REVOKE INSERT, UPDATE ON forum_topic_reads FROM CURRENT_USER`)
	assert.NilError(t, err)

	host.userID = reader
	target := fmt.Sprintf("/forum/topic/%d", topic)
	host.get(t, f, target)
	assert.Equal(t, host.found(t, target), true)
	assert.Equal(t, host.status, http.StatusOK)
	assert.Equal(t, len(host.logged), 1)
}

func TestUnreadTopics(t *testing.T) {
	db := forumtest.NewDB(t)
	f := newTestForum(t, db, &testHost{})
	ctx := context.Background()
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	section := newSection(t, db, "section")
	other := newSection(t, db, "other")

	t.Run("a new topic is unread for all but its author", func(t *testing.T) {
		topic, _ := mustCreateTopic(t, f, section, alice, "new", at(1))
		assert.Equal(t, unread(t, f, section, alice)[topic], false)
		assert.Equal(t, unread(t, f, section, bob)[topic], true)
		assert.Equal(t, unread(t, f, section, 0)[topic], false)
		assert.Equal(t, sectionUnread(t, f, section, bob), true)
	})

	t.Run("a reply makes a read topic unread for the others", func(t *testing.T) {
		topic, first := mustCreateTopic(t, f, section, alice, "replied", at(2))
		assert.NilError(t, readTopicUpTo(ctx, db, bob, topic, first))
		assert.Equal(t, unread(t, f, section, bob)[topic], false)
		mustReply(t, f, topic, alice, "reply", at(3))
		assert.Equal(t, unread(t, f, section, bob)[topic], true)
		assert.Equal(t, unread(t, f, section, alice)[topic], false)
		// Bob answers without opening the page: his reply reads it up to itself.
		mustReply(t, f, topic, bob, "answer", at(4))
		assert.Equal(t, unread(t, f, section, bob)[topic], false)
		assert.Equal(t, unread(t, f, section, alice)[topic], true)
	})

	t.Run("a deleted last post does not make a topic unread", func(t *testing.T) {
		topic, first := mustCreateTopic(t, f, section, alice, "deleted reply", at(5))
		assert.NilError(t, readTopicUpTo(ctx, db, bob, topic, first))
		deletePost(t, db, mustReply(t, f, topic, alice, "reply", at(6)))
		assert.Equal(t, unread(t, f, section, bob)[topic], false)
	})

	t.Run("a moved topic follows the mark of its new section", func(t *testing.T) {
		moved, _ := mustCreateTopic(t, f, section, alice, "moved", at(7))
		mustCreateTopic(t, f, other, alice, "newer in other", at(8))
		assert.NilError(t, f.markRead(ctx, bob, &other))
		assert.Equal(t, unread(t, f, section, bob)[moved], true)
		_, err := db.Exec(ctx, `UPDATE forum_topics SET section_id = $1 WHERE id = $2`, other, moved)
		assert.NilError(t, err)
		assert.Equal(t, unread(t, f, other, bob)[moved], false)
		_, err = db.Exec(ctx, `UPDATE forum_topics SET section_id = $1 WHERE id = $2`, section, moved)
		assert.NilError(t, err)
		assert.Equal(t, unread(t, f, section, bob)[moved], true)
	})

	t.Run("what was written before the registration is read", func(t *testing.T) {
		topic, _ := mustCreateTopic(t, f, section, alice, "old", at(9))
		carol := forumtest.User(t, db, "carol", at(10))
		assert.Equal(t, unread(t, f, section, carol)[topic], false)
		mustReply(t, f, topic, alice, "news", at(11))
		assert.Equal(t, unread(t, f, section, carol)[topic], true)
		// The home counts the same.
		dave := forumtest.User(t, db, "dave", at(1000))
		assert.Equal(t, sectionUnread(t, f, section, dave), false)
		assert.Equal(t, sectionUnread(t, f, section, carol), true)
	})
}

func TestFirstUnread(t *testing.T) {
	db := forumtest.NewDB(t)
	host := &testHost{}
	f := newTestForum(t, db, host)
	ctx := context.Background()
	author := forumtest.User(t, db, "author", at(0))
	reader := forumtest.User(t, db, "reader", at(0))
	section := newSection(t, db, "section")
	topic, posts := longTopic(t, f, section, author)
	path := fmt.Sprintf("/forum/topic/%d", topic)

	redirect := func(viewer int) string {
		t.Helper()
		host.userID = viewer
		rec := host.get(t, f, path+"/unread")
		if rec.Code != http.StatusFound {
			t.Fatalf("status %d, want 302", rec.Code)
		}
		return rec.Header().Get("Location")
	}

	// Nothing read: the first post.
	assert.Equal(t, redirect(reader), path+"#post-"+fmt.Sprint(posts[0]))
	// Read up to post #20: the second page.
	assert.NilError(t, readTopicUpTo(ctx, db, reader, topic, posts[19]))
	assert.Equal(t, redirect(reader), path+"?page=2#post-"+fmt.Sprint(posts[20]))
	// A deleted post is not news: the next visible one.
	deletePost(t, db, posts[20])
	assert.Equal(t, redirect(reader), path+"?page=2#post-"+fmt.Sprint(posts[21]))
	// The section mark counts as the topic's.
	assert.NilError(t, f.markRead(ctx, reader, &section))
	assert.Equal(t, redirect(reader), path)
	reply := mustReply(t, f, topic, author, "news", at(100))
	assert.Equal(t, redirect(reader), path+"?page=3#post-"+fmt.Sprint(reply))
	// All read, a guest, a user registered after the last post: the first page.
	assert.NilError(t, readTopicUpTo(ctx, db, reader, topic, reply))
	assert.Equal(t, redirect(reader), path)
	assert.Equal(t, redirect(0), path)
	assert.Equal(t, redirect(forumtest.User(t, db, "newcomer", at(200))), path)

	// The list leads an unread topic to its first unread post, a read one to the topic.
	other, _ := mustCreateTopic(t, f, section, author, "other", at(101))
	host.userID = reader
	host.get(t, f, fmt.Sprintf("/forum/section/%d", section))
	body := string(host.page.Body)
	assert.StringContains(t, body, fmt.Sprintf(`href="/forum/topic/%d/unread"`, other))
	assert.StringContains(t, body, fmt.Sprintf(`href="%s"`, path))
	if strings.Contains(body, path+"/unread") {
		t.Error("a read topic links to its first unread post")
	}

	// No topic, a deleted one: not found, as the topic itself.
	host.get(t, f, "/forum/topic/999999/unread")
	assert.Equal(t, host.notFound, true)
	deleteTopic(t, db, other)
	host.get(t, f, fmt.Sprintf("/forum/topic/%d/unread", other))
	assert.Equal(t, host.notFound, true)
}

func TestMarkRead(t *testing.T) {
	db := forumtest.NewDB(t)
	host := &testHost{}
	f := newTestForum(t, db, host)
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	section := newSection(t, db, "section")
	other := newSection(t, db, "other")
	here, _ := mustCreateTopic(t, f, section, alice, "here", at(1))
	there, _ := mustCreateTopic(t, f, other, alice, "there", at(2))
	sectionPath := fmt.Sprintf("/forum/section/%d", section)

	// The button is offered to the signed in only.
	host.userID = 0
	host.get(t, f, sectionPath)
	if strings.Contains(string(host.page.Body), "forum-mark-read") {
		t.Error("a guest is offered «Mark as read» in a section")
	}
	host.get(t, f, "/forum/")
	if strings.Contains(string(host.page.Body), "forum-mark-read") {
		t.Error("a guest is offered «Mark all as read»")
	}
	host.userID = bob
	host.get(t, f, sectionPath)
	assert.StringContains(t, string(host.page.Body), `action="`+sectionPath+`/read"`)
	host.get(t, f, "/forum/")
	assert.StringContains(t, string(host.page.Body), `action="/forum/read"`)

	// A guest's form marks nothing.
	host.userID = 0
	rec := host.post(t, f, sectionPath+"/read", url.Values{})
	assert.Equal(t, rec.Code, http.StatusForbidden)
	assert.Equal(t, host.post(t, f, "/forum/read", url.Values{}).Code, http.StatusForbidden)
	var marks int
	assert.NilError(t, db.QueryRow(context.Background(), `SELECT count(*) FROM forum_read_marks`).Scan(&marks))
	assert.Equal(t, marks, 0)

	// The section's button reads that section only.
	host.userID = bob
	assert.Equal(t, redirectedTo(t, host.post(t, f, sectionPath+"/read", url.Values{})), sectionPath)
	assert.Equal(t, unread(t, f, section, bob)[here], false)
	assert.Equal(t, unread(t, f, other, bob)[there], true)
	assert.Equal(t, sectionUnread(t, f, section, bob), false)
	assert.Equal(t, sectionUnread(t, f, other, bob), true)
	// A reply after the button makes the topic unread again.
	mustReply(t, f, here, alice, "reply", at(3))
	assert.Equal(t, unread(t, f, section, bob)[here], true)

	// The home's button reads every section.
	assert.Equal(t, redirectedTo(t, host.post(t, f, "/forum/read", url.Values{})), "/forum/")
	assert.Equal(t, unread(t, f, section, bob)[here], false)
	assert.Equal(t, unread(t, f, other, bob)[there], false)
	mustReply(t, f, there, alice, "reply", at(4))
	assert.Equal(t, unread(t, f, other, bob)[there], true)
	// Pressed again, it keeps one row.
	host.post(t, f, "/forum/read", url.Values{})
	assert.NilError(t, db.QueryRow(context.Background(),
		`SELECT count(*) FROM forum_read_marks WHERE user_id = $1 AND section_id IS NULL`, bob).Scan(&marks))
	assert.Equal(t, marks, 1)
	assert.Equal(t, unread(t, f, other, bob)[there], false)

	host.post(t, f, "/forum/section/999999/read", url.Values{})
	assert.Equal(t, host.notFound, true)
}
