package forum

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// WipeUser takes the user out of the forum when their account is wiped (UserModel.Wipe, plan
// _prd/account_deletion, sections 4.1 and 4.3), in its transaction; the users row stays as a
// tombstone, so topics, posts and the moderation log keep pointing at it. Their profile, reads,
// subscriptions, notifications, bans and moderator rights go, and their name leaves the quote
// notifications of others. With wipePosts their posts lose the text and are deleted, and a topic
// nobody else wrote in goes whole, its title too, in the notifications of it as well. What
// moderators wrote in forum_mod_log stays (decision 23).
func WipeUser(ctx context.Context, tx pgx.Tx, userID int, wipePosts bool, at time.Time) error {
	if wipePosts {
		if _, err := tx.Exec(ctx, `
			WITH own AS (
				UPDATE forum_topics t
				SET title = '', deleted_at = COALESCE(t.deleted_at, $2), deleted_by = COALESCE(t.deleted_by, $1)
				WHERE t.author_id = $1
				  AND NOT EXISTS (SELECT 1 FROM forum_posts p WHERE p.topic_id = t.id AND p.author_id <> $1)
				RETURNING t.id
			)
			UPDATE forum_notifications n SET params = n.params || '{"title": ""}'
			FROM own WHERE n.topic_id = own.id AND n.params ? 'title'`, userID, at); err != nil {
			return err
		}
		// A post a moderator deleted keeps their name in deleted_by.
		rows, err := tx.Query(ctx, `
			UPDATE forum_posts
			SET body = '', deleted_at = COALESCE(deleted_at, $2), deleted_by = COALESCE(deleted_by, $1)
			WHERE author_id = $1
			RETURNING id, topic_id`, userID, at)
		if err != nil {
			return err
		}
		if _, err := recountTouched(ctx, tx, rows); err != nil && !errors.Is(err, errNoChange) {
			return err
		}
	}
	// The name a quote notification keeps is of the quoting post's author (notifyOfReply).
	if _, err := tx.Exec(ctx, `
		UPDATE forum_notifications SET params = params || '{"name": ""}'
		WHERE kind = $2 AND post_id IN (SELECT id FROM forum_posts WHERE author_id = $1)`,
		userID, string(notifyQuote)); err != nil {
		return err
	}
	for _, table := range []string{
		"forum_profiles", "forum_topic_reads", "forum_read_marks", "forum_subscriptions",
		"forum_notifications", "forum_moderators", "forum_bans",
	} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE user_id = $1`, userID); err != nil {
			return err
		}
	}
	return nil
}
