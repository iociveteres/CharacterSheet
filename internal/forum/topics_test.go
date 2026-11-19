package forum

import (
	"context"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func readTopic(t *testing.T, db *pgxpool.Pool, id int) Topic {
	t.Helper()
	rows, err := db.Query(context.Background(), `
		SELECT id, section_id, author_id, title, pinned, closed, created_at, deleted_at,
		       reply_count, last_post_id, last_post_at
		FROM forum_topics WHERE id = $1`, id)
	if err != nil {
		t.Fatal(err)
	}
	topic, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[Topic])
	if err != nil {
		t.Fatal(err)
	}
	return topic
}

func insertPost(t *testing.T, tx pgx.Tx, topicID, authorID int, at time.Time) int {
	t.Helper()
	var id int
	err := tx.QueryRow(context.Background(), `
		INSERT INTO forum_posts (topic_id, author_id, body, created_at) VALUES ($1, $2, 'text', $3)
		RETURNING id`, topicID, authorID, at).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestRecountTopic(t *testing.T) {
	db := forumtest.NewDB(t)
	ctx := context.Background()
	author := forumtest.User(t, db, "author", time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	day := func(d int) time.Time { return time.Date(2026, 2, d, 12, 0, 0, 0, time.UTC) }

	// change runs in a transaction of its own and recounts the topic before the commit, as the
	// handlers do.
	change := func(topicID int, f func(tx pgx.Tx)) {
		t.Helper()
		tx, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		f(tx)
		assert.NilError(t, recountTopic(ctx, tx, topicID))
		assert.NilError(t, tx.Commit(ctx))
	}
	setDeleted := func(postID int, deleted bool) func(tx pgx.Tx) {
		return func(tx pgx.Tx) {
			sql := `UPDATE forum_posts SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`
			if deleted {
				sql = `UPDATE forum_posts SET deleted_at = now(), deleted_by = author_id WHERE id = $1`
			}
			if _, err := tx.Exec(ctx, sql, postID); err != nil {
				t.Fatal(err)
			}
		}
	}
	check := func(topicID, replies int, lastPost *int, lastAt time.Time) {
		t.Helper()
		topic := readTopic(t, db, topicID)
		assert.Equal(t, topic.ReplyCount, replies)
		if (topic.LastPostID == nil) != (lastPost == nil) || lastPost != nil && *topic.LastPostID != *lastPost {
			t.Errorf("last_post_id = %v, want %v", topic.LastPostID, lastPost)
		}
		assert.Equal(t, topic.LastPostAt.Equal(lastAt), true)
	}

	var topicID, first int
	topicCreated := day(1)
	tx, err := db.Begin(ctx)
	assert.NilError(t, err)
	err = tx.QueryRow(ctx, `
		INSERT INTO forum_topics (section_id, author_id, title, created_at)
		VALUES ((SELECT min(id) FROM forum_sections), $1, 'topic', $2) RETURNING id`,
		author, topicCreated).Scan(&topicID)
	assert.NilError(t, err)
	first = insertPost(t, tx, topicID, author, day(1))
	assert.NilError(t, recountTopic(ctx, tx, topicID))
	assert.NilError(t, tx.Commit(ctx))
	check(topicID, 0, &first, day(1))

	var r1, r2 int
	change(topicID, func(tx pgx.Tx) { r1 = insertPost(t, tx, topicID, author, day(2)) })
	change(topicID, func(tx pgx.Tx) { r2 = insertPost(t, tx, topicID, author, day(3)) })
	check(topicID, 2, &r2, day(3))

	change(topicID, setDeleted(r2, true))
	check(topicID, 1, &r1, day(2))

	change(topicID, setDeleted(r2, false))
	check(topicID, 2, &r2, day(3))

	// A deleted reply in the middle leaves the last post alone.
	change(topicID, setDeleted(r1, true))
	check(topicID, 1, &r2, day(3))

	// The first post is never a reply, deleted or not.
	change(topicID, setDeleted(first, true))
	check(topicID, 1, &r2, day(3))

	change(topicID, setDeleted(r2, true))
	check(topicID, 0, nil, topicCreated)

	change(topicID, setDeleted(first, false))
	check(topicID, 0, &first, day(1))
}

// Two replies to one topic at once: the recount that waits for the other transaction's lock must
// still see that transaction's post once it commits.
func TestRecountTopicConcurrentReplies(t *testing.T) {
	db := forumtest.NewDB(t)
	ctx := context.Background()
	author := forumtest.User(t, db, "author", time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
	now := time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC)

	var topicID int
	err := db.QueryRow(ctx, `
		INSERT INTO forum_topics (section_id, author_id, title)
		VALUES ((SELECT min(id) FROM forum_sections), $1, 'topic') RETURNING id`, author).Scan(&topicID)
	assert.NilError(t, err)

	begin := func() pgx.Tx {
		tx, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { tx.Rollback(ctx) })
		return tx
	}
	// Both insert before either recounts: the order that deadlocks with a lock too strong.
	tx1, tx2 := begin(), begin()
	insertPost(t, tx1, topicID, author, now)
	last := insertPost(t, tx2, topicID, author, now.Add(time.Minute))
	assert.NilError(t, recountTopic(ctx, tx1, topicID))

	done := make(chan error, 1)
	go func() { done <- recountTopic(ctx, tx2, topicID) }()
	// Commit tx1 only once tx2 waits for the lock, or the race is not exercised.
	deadline := time.Now().Add(10 * time.Second)
	for waiting := false; !waiting; {
		if time.Now().After(deadline) {
			t.Fatal("the second recount never waited for the lock")
		}
		err := db.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM pg_stat_activity
			               WHERE datname = current_database() AND wait_event_type = 'Lock'
			                 AND query LIKE '%forum_topics%')`).Scan(&waiting)
		assert.NilError(t, err)
		select {
		case err := <-done:
			t.Fatalf("the second recount did not wait for the first transaction: %v", err)
		default:
		}
		time.Sleep(10 * time.Millisecond)
	}
	assert.NilError(t, tx1.Commit(ctx))
	assert.NilError(t, <-done)
	assert.NilError(t, tx2.Commit(ctx))

	topic := readTopic(t, db, topicID)
	assert.Equal(t, topic.ReplyCount, 1)
	assert.Equal(t, *topic.LastPostID, last)
}
