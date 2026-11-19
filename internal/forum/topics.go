package forum

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Topic is a row of forum_topics.
type Topic struct {
	ID         int
	SectionID  int
	AuthorID   int
	Title      string
	Pinned     bool
	Closed     bool
	CreatedAt  time.Time
	DeletedAt  *time.Time
	ReplyCount int
	LastPostID *int
	LastPostAt time.Time
}

func (t Topic) Deleted() bool {
	return t.DeletedAt != nil
}

// recountTopic counts reply_count, last_post_id and last_post_at of the topic from its visible
// posts. Call it in the transaction that creates, deletes or restores a post of the topic, after
// the change.
func recountTopic(ctx context.Context, tx pgx.Tx, topicID int) error {
	// The lock is a statement of its own: under READ COMMITTED the UPDATE below then takes its
	// snapshot after a concurrent post of the same topic has committed. Inside one statement the
	// subqueries would keep the snapshot from before the wait and miss that post. NO KEY: FOR UPDATE
	// conflicts with the key share lock an insert into forum_posts takes on its topic, and two
	// replies that both inserted before recounting would deadlock.
	if _, err := tx.Exec(ctx, `SELECT 1 FROM forum_topics WHERE id = $1 FOR NO KEY UPDATE`, topicID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE forum_topics t
		SET reply_count  = r.n,
		    last_post_id = l.id,
		    last_post_at = COALESCE(l.created_at, t.created_at)
		FROM (
			-- The first post opens the topic even when deleted: it is never a reply.
			SELECT count(*) AS n FROM forum_posts
			WHERE topic_id = $1 AND deleted_at IS NULL
			  AND id > (SELECT min(id) FROM forum_posts WHERE topic_id = $1)
		) r
		LEFT JOIN LATERAL (
			SELECT id, created_at FROM forum_posts
			WHERE topic_id = $1 AND deleted_at IS NULL
			ORDER BY id DESC LIMIT 1
		) l ON true
		WHERE t.id = $1`, topicID)
	return err
}
