package main

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The sections the forum scenarios (e2e/scenarios/forum) write in: topics start in the first and
// a moderator moves them to the second. Every seed empties both.
const (
	forumScenarioSection = "E2E scenarios"
	forumMovedSection    = "E2E moved"
)

// longTopicPosts puts the seeded long topic on two pages of 20, so that a post on its first page is
// not on the page with the reply form.
const longTopicPosts = 23

type forumSeed struct {
	Section int `json:"section"`
	MovedTo int `json:"movedTo"`
	// A topic of the gm on two pages, written in turns by the gm, the player and player2.
	LongTopic int `json:"longTopic"`
}

// ensureForum makes the seeded moderator a moderator of the forum too, gives the scenarios their
// sections, empty but for the long topic, and starts the seeded users' forum afresh: no
// notifications and no bans. Grants of the real site are rows of forum_moderators written by hand:
// there is no UI for them.
func ensureForum(ctx context.Context, db *pgxpool.Pool) (forumSeed, error) {
	var out forumSeed
	gm, moderator, player, player2 := users[0], users[1], users[2], users[3]
	ids := make([]int, len(users))
	for i, u := range users {
		ids[i] = u.ID
	}
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
INSERT INTO forum_moderators (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, moderator.ID); err != nil {
			return err
		}
		// A user younger than a day may post once a minute: a fresh database would stall the scenarios.
		if _, err := tx.Exec(ctx, `
UPDATE users SET created_at = now() - interval '2 days'
WHERE id = ANY($1) AND created_at > now() - interval '2 days'`, ids); err != nil {
			return err
		}
		var err error
		if out.Section, err = ensureForumSection(ctx, tx, forumScenarioSection); err != nil {
			return err
		}
		if out.MovedTo, err = ensureForumSection(ctx, tx, forumMovedSection); err != nil {
			return err
		}
		args := pgx.NamedArgs{"sections": []int{out.Section, out.MovedTo}, "users": ids, "moderator": moderator.ID}
		for _, q := range []string{
			`DELETE FROM forum_notifications WHERE user_id = ANY(@users)
			    OR topic_id IN (SELECT id FROM forum_topics WHERE section_id = ANY(@sections))
			    OR post_id IN (SELECT p.id FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id WHERE t.section_id = ANY(@sections))`,
			`DELETE FROM forum_mod_log WHERE section_id = ANY(@sections)
			    OR topic_id IN (SELECT id FROM forum_topics WHERE section_id = ANY(@sections))
			    OR post_id IN (SELECT p.id FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id WHERE t.section_id = ANY(@sections))`,
			`DELETE FROM forum_subscriptions WHERE topic_id IN (SELECT id FROM forum_topics WHERE section_id = ANY(@sections))`,
			`DELETE FROM forum_topic_reads WHERE topic_id IN (SELECT id FROM forum_topics WHERE section_id = ANY(@sections))`,
			`DELETE FROM forum_read_marks WHERE section_id = ANY(@sections)`,
			`DELETE FROM forum_posts WHERE topic_id IN (SELECT id FROM forum_topics WHERE section_id = ANY(@sections))`,
			`DELETE FROM forum_topics WHERE section_id = ANY(@sections)`,
			`UPDATE forum_bans SET lifted_at = now(), lifted_by = @moderator WHERE user_id = ANY(@users) AND lifted_at IS NULL`,
		} {
			if _, err := tx.Exec(ctx, q, args); err != nil {
				return err
			}
		}
		out.LongTopic, err = seedLongTopic(ctx, tx, out.Section, []*seedUser{gm, player, player2})
		return err
	})
	if err != nil {
		return out, err
	}
	return out, nil
}

func ensureForumSection(ctx context.Context, tx pgx.Tx, name string) (int, error) {
	var id int
	err := tx.QueryRow(ctx, `SELECT id FROM forum_sections WHERE name = $1 ORDER BY id LIMIT 1`, name).Scan(&id)
	if err == pgx.ErrNoRows {
		err = tx.QueryRow(ctx, `
INSERT INTO forum_sections (name, description, position)
SELECT $1, 'Written in by the browser scenarios; emptied by every npm run seed.', coalesce(max(position), 0) + 1
FROM forum_sections
RETURNING id`, name).Scan(&id)
	}
	return id, err
}

// seedLongTopic writes a topic a day old, read by nobody, with the counted columns the forum keeps.
func seedLongTopic(ctx context.Context, tx pgx.Tx, section int, authors []*seedUser) (int, error) {
	var topic int
	if err := tx.QueryRow(ctx, `
INSERT INTO forum_topics (section_id, author_id, title, created_at)
VALUES ($1, $2, 'Long topic', now() - interval '1 day')
RETURNING id`, section, authors[0].ID).Scan(&topic); err != nil {
		return 0, err
	}
	for i := 0; i < longTopicPosts; i++ {
		if _, err := tx.Exec(ctx, `
INSERT INTO forum_posts (topic_id, author_id, body, created_at)
VALUES ($1, $2, $3, now() - interval '1 day' + $4 * interval '1 minute')`,
			topic, authors[i%len(authors)].ID, fmt.Sprintf("Post %d of the long topic.", i+1), i); err != nil {
			return 0, err
		}
	}
	_, err := tx.Exec(ctx, `
UPDATE forum_topics t
SET reply_count = (SELECT count(*) - 1 FROM forum_posts WHERE topic_id = t.id),
    (last_post_id, last_post_at) = (SELECT id, created_at FROM forum_posts WHERE topic_id = t.id ORDER BY id DESC LIMIT 1)
WHERE id = $1`, topic)
	return topic, err
}
