package main

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ensureForum makes the seeded moderator a moderator of the forum too, so that the moderation of
// the forum can be looked at in a browser. Grants of the real site are rows of forum_moderators
// written by hand: there is no UI for them.
func ensureForum(ctx context.Context, db *pgxpool.Pool, moderator *seedUser) error {
	_, err := db.Exec(ctx, `
INSERT INTO forum_moderators (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, moderator.ID)
	return err
}
