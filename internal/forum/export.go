package forum

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// What the export of a user's data (plan _prd/account_deletion, section 6.3) takes from the
// forum: their topics, posts, profile with subscriptions and the bans they got. The moderation
// log stays out (decision 15). The JSON names are those of the archive's files.

// Querier is what the readers of the export need of a pool or a transaction.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type ExportTopic struct {
	ID        int       `json:"id"`
	Section   string    `json:"section"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	Deleted   bool      `json:"deleted"`
}

// ExportTopics calls fn with each topic the user started, oldest first.
func ExportTopics(ctx context.Context, q Querier, userID int, fn func(ExportTopic) error) error {
	rows, err := q.Query(ctx, `
		SELECT t.id, s.name, t.title, t.created_at, t.deleted_at IS NOT NULL
		FROM forum_topics t JOIN forum_sections s ON s.id = t.section_id
		WHERE t.author_id = $1
		ORDER BY t.id`, userID)
	if err != nil {
		return err
	}
	var t ExportTopic
	_, err = pgx.ForEachRow(rows, []any{&t.ID, &t.Section, &t.Title, &t.CreatedAt, &t.Deleted}, func() error {
		return fn(t)
	})
	return err
}

type ExportPost struct {
	ID      int    `json:"id"`
	TopicID int    `json:"topicId"`
	Topic   string `json:"topic"`
	// Body is the Markdown as the user wrote it.
	Body      string     `json:"body"`
	CreatedAt time.Time  `json:"createdAt"`
	EditedAt  *time.Time `json:"editedAt"`
	Deleted   bool       `json:"deleted"`
}

// ExportPosts calls fn with each post of the user, oldest first. Rows are read one by one: a
// user may have written many.
func ExportPosts(ctx context.Context, q Querier, userID int, fn func(ExportPost) error) error {
	rows, err := q.Query(ctx, `
		SELECT p.id, p.topic_id, t.title, p.body, p.created_at, p.edited_at, p.deleted_at IS NOT NULL
		FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id
		WHERE p.author_id = $1
		ORDER BY p.id`, userID)
	if err != nil {
		return err
	}
	var p ExportPost
	_, err = pgx.ForEachRow(rows, []any{&p.ID, &p.TopicID, &p.Topic, &p.Body, &p.CreatedAt, &p.EditedAt, &p.Deleted}, func() error {
		return fn(p)
	})
	return err
}

type ExportProfile struct {
	About         string               `json:"about"`
	Subscriptions []ExportSubscription `json:"subscriptions"`
}

type ExportSubscription struct {
	TopicID int       `json:"topicId"`
	Topic   string    `json:"topic"`
	Since   time.Time `json:"since"`
}

// ExportUserProfile is the user's "About me" and the topics they follow.
func ExportUserProfile(ctx context.Context, q Querier, userID int) (*ExportProfile, error) {
	p := &ExportProfile{Subscriptions: []ExportSubscription{}}
	err := q.QueryRow(ctx, `SELECT COALESCE((SELECT about FROM forum_profiles WHERE user_id = $1), '')`, userID).Scan(&p.About)
	if err != nil {
		return nil, err
	}
	rows, err := q.Query(ctx, `
		SELECT s.topic_id, t.title, s.created_at
		FROM forum_subscriptions s JOIN forum_topics t ON t.id = s.topic_id
		WHERE s.user_id = $1
		ORDER BY s.created_at, s.topic_id`, userID)
	if err != nil {
		return nil, err
	}
	var s ExportSubscription
	_, err = pgx.ForEachRow(rows, []any{&s.TopicID, &s.Topic, &s.Since}, func() error {
		p.Subscriptions = append(p.Subscriptions, s)
		return nil
	})
	return p, err
}

// ExportBan is a forum ban the user got, without the moderator: the user sees bans so.
type ExportBan struct {
	Reason    string     `json:"reason"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt"`
	LiftedAt  *time.Time `json:"liftedAt"`
}

// ExportBans is every forum ban the user got, lifted ones too, oldest first.
func ExportBans(ctx context.Context, q Querier, userID int) ([]ExportBan, error) {
	rows, err := q.Query(ctx, `
		SELECT reason, created_at, expires_at, lifted_at FROM forum_bans
		WHERE user_id = $1 ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[ExportBan])
}
