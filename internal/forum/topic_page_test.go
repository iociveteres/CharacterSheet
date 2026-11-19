package forum

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCreateTopicAndReply(t *testing.T) {
	db := forumtest.NewDB(t)
	f := newTestForum(t, db, &testHost{})
	ctx := context.Background()
	alice := forumtest.User(t, db, "alice", at(0))
	bob := forumtest.User(t, db, "bob", at(0))
	section := newSection(t, db, "section")

	topicID, first, err := f.createTopic(ctx, section, alice, "title", "body", at(1))
	assert.NilError(t, err)
	topic := readTopic(t, db, topicID)
	assert.Equal(t, topic.SectionID, section)
	assert.Equal(t, topic.AuthorID, alice)
	assert.Equal(t, topic.Title, "title")
	assert.Equal(t, topic.CreatedAt.Equal(at(1)), true)
	assert.Equal(t, topic.ReplyCount, 0)
	assert.Equal(t, *topic.LastPostID, first)
	assert.Equal(t, topic.LastPostAt.Equal(at(1)), true)
	var postTopic, postAuthor int
	var body string
	err = db.QueryRow(ctx, `SELECT topic_id, author_id, body FROM forum_posts WHERE id = $1`, first).
		Scan(&postTopic, &postAuthor, &body)
	assert.NilError(t, err)
	assert.Equal(t, postTopic, topicID)
	assert.Equal(t, postAuthor, alice)
	assert.Equal(t, body, "body")

	reply, err := f.reply(ctx, topicID, bob, "reply", at(2))
	assert.NilError(t, err)
	topic = readTopic(t, db, topicID)
	assert.Equal(t, topic.ReplyCount, 1)
	assert.Equal(t, *topic.LastPostID, reply)
	assert.Equal(t, topic.LastPostAt.Equal(at(2)), true)

	// A failure leaves nothing behind: no topic without its first post, no post without a recount.
	count := func() (topics, posts int) {
		t.Helper()
		err := db.QueryRow(ctx, `SELECT (SELECT count(*) FROM forum_topics), (SELECT count(*) FROM forum_posts)`).
			Scan(&topics, &posts)
		assert.NilError(t, err)
		return topics, posts
	}
	topics, posts := count()
	if _, _, err = f.createTopic(ctx, section, 999999, "title", "body", at(3)); err == nil {
		t.Fatal("a topic of a user that does not exist")
	}
	if _, err = f.reply(ctx, 999999, alice, "reply", at(3)); err == nil {
		t.Fatal("a reply to a topic that does not exist")
	}
	gotTopics, gotPosts := count()
	assert.Equal(t, gotTopics, topics)
	assert.Equal(t, gotPosts, posts)
}

// posts45 makes a topic of 45 posts, the first one included: three pages, the last one not full.
func posts45(t *testing.T, f *Forum, db *pgxpool.Pool) (topicID int, posts []int) {
	t.Helper()
	author := forumtest.User(t, db, "author", at(0))
	topicID, first := mustCreateTopic(t, f, newSection(t, db, "section"), author, "topic", at(0))
	posts = []int{first}
	for i := 1; i < 45; i++ {
		posts = append(posts, mustReply(t, f, topicID, author, fmt.Sprintf("reply %d", i), at(i)))
	}
	return topicID, posts
}

func TestPostRedirect(t *testing.T) {
	db := forumtest.NewDB(t)
	host := &testHost{}
	f := newTestForum(t, db, host)
	moderator := newModerator(t, db, "moderator")
	topicID, posts := posts45(t, f, db)
	// A deleted post keeps its place: the posts after it stay on their pages.
	deletePost(t, db, posts[4])
	topic := fmt.Sprintf("/forum/topic/%d", topicID)

	for _, tt := range []struct {
		number int // the place in the topic, from 1
		page   string
	}{{1, ""}, {5, ""}, {20, ""}, {21, "?page=2"}, {40, "?page=2"}, {41, "?page=3"}, {45, "?page=3"}} {
		id := posts[tt.number-1]
		rec := host.get(t, f, fmt.Sprintf("/forum/post/%d", id))
		assert.Equal(t, rec.Code, http.StatusFound)
		assert.Equal(t, rec.Header().Get("Location"), fmt.Sprintf("%s%s#post-%d", topic, tt.page, id))
		// The page it leads to holds the anchor.
		host.get(t, f, topic+tt.page)
		assert.StringContains(t, string(host.page.Body), fmt.Sprintf(`id="post-%d"`, id))
	}

	for _, target := range []string{"/forum/post/999999", "/forum/post/abc", "/forum/post/0"} {
		host.get(t, f, target)
		assert.Equal(t, host.found(t, target), false)
	}

	// The posts of a deleted topic are gone for all but moderators.
	deleteTopic(t, db, topicID)
	target := fmt.Sprintf("/forum/post/%d", posts[0])
	host.get(t, f, target)
	assert.Equal(t, host.found(t, target), false)
	host.userID = moderator
	rec := host.get(t, f, target)
	assert.Equal(t, rec.Code, http.StatusFound)
}

func TestTopicPage(t *testing.T) {
	db := forumtest.NewDB(t)
	host := &testHost{}
	f := newTestForum(t, db, host)
	ctx := context.Background()
	moderator := newModerator(t, db, "moderator")
	topicID, posts := posts45(t, f, db)
	path := fmt.Sprintf("/forum/topic/%d", topicID)
	if _, err := db.Exec(ctx, `UPDATE forum_posts SET body = $1 WHERE id = $2`,
		"**Bold** start with a ||secret|| inside\n\n"+strings.Repeat("word ", 50), posts[0]); err != nil {
		t.Fatal(err)
	}
	found := func(target string) bool {
		t.Helper()
		host.get(t, f, target)
		return host.found(t, target)
	}
	articles := func() int {
		return strings.Count(string(host.page.Body), `<article class="forum-post`)
	}

	assert.Equal(t, found(path), true)
	assert.Equal(t, host.page.Title, "topic")
	assert.Equal(t, host.page.Canonical, "https://example.com"+path)
	if d := host.page.Description; !strings.HasPrefix(d, "Bold start with a inside word word") ||
		!strings.HasSuffix(d, "…") || len([]rune(d)) > descriptionLength+1 {
		t.Errorf("description %q", d)
	}
	assert.Equal(t, articles(), 20)

	assert.Equal(t, found(path+"?page=2"), true)
	assert.Equal(t, host.page.Title, "topic")
	assert.Equal(t, host.page.Canonical, "https://example.com"+path+"?page=2")
	assert.Equal(t, found(path+"?page=3"), true)
	assert.Equal(t, articles(), 5)
	for _, page := range []string{"4", "0", "x"} {
		assert.Equal(t, found(path+"?page="+page), false)
	}

	// Without its first post the topic is described by its title.
	deletePost(t, db, posts[0])
	assert.Equal(t, found(path), true)
	assert.Equal(t, host.page.Description, "topic")

	// A topic whose posts are all deleted still shows their places, without their text.
	for _, id := range posts[1:] {
		deletePost(t, db, id)
	}
	assert.Equal(t, found(path+"?page=3"), true)
	body := string(host.page.Body)
	assert.Equal(t, strings.Count(body, `<article class="forum-post forum-post-deleted"`), 5)
	assert.Equal(t, strings.Contains(body, "reply 44"), false)

	// A deleted topic is a 404 for all but moderators.
	deleteTopic(t, db, topicID)
	assert.Equal(t, found(path), false)
	host.userID = moderator
	assert.Equal(t, found(path), true)
	assert.Equal(t, found("/forum/topic/999999"), false)
}

func TestTopicPosts(t *testing.T) {
	db := forumtest.NewDB(t)
	f := newTestForum(t, db, &testHost{})
	ctx := context.Background()
	alice := forumtest.User(t, db, "alice", at(-60*24))
	bob := forumtest.User(t, db, "bob", at(0))
	section := newSection(t, db, "section")

	topic, first := mustCreateTopic(t, f, section, alice, "topic", at(1))
	deleted := mustReply(t, f, topic, alice, "deleted reply", at(2))
	mustReply(t, f, topic, bob, "reply", at(3))
	deletePost(t, db, deleted)
	// The posts of a deleted topic are not counted either: nobody but moderators can find them.
	other, _ := mustCreateTopic(t, f, section, alice, "other", at(4))
	mustReply(t, f, other, alice, "reply", at(5))
	gone, _ := mustCreateTopic(t, f, section, alice, "gone", at(6))
	deleteTopic(t, db, gone)

	posts, err := f.topicPosts(ctx, topic, 1)
	assert.NilError(t, err)
	assert.Equal(t, len(posts), 3)
	assert.Equal(t, posts[0].ID, first)
	assert.Equal(t, posts[0].AuthorName, "alice")
	assert.Equal(t, posts[0].AuthorRegisteredAt.Equal(at(-60*24)), true)
	assert.Equal(t, posts[0].AuthorPosts, 3)
	assert.Equal(t, posts[1].Deleted(), true)
	assert.Equal(t, posts[1].Body, "")
	assert.Equal(t, posts[2].AuthorPosts, 1)
	for i, p := range posts {
		assert.Equal(t, p.Number, i+1)
	}
}
