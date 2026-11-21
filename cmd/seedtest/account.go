package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"charactersheet.iociveteres.net/internal/models"
)

// leaverDeleteToken opens the leaver's deletion page, /account/delete/token/<it>: the link of the
// email, which the real server sends to no test mailbox. 26 characters of base32, as generateToken
// makes them.
const leaverDeleteToken = "LEAVERDELETETOKENE2ETESTAA"

type accountSeed struct {
	// The plaintext of the leaver's delete_account token.
	DeleteToken string `json:"deleteToken"`
	// The leaver's folder in the room, with their sheet in it.
	LeaverFolder int `json:"leaverFolder"`
}

// resetLeaver cancels a deletion of the leaver that a failed scenario left scheduled, and drops
// their data export, so that the scenario finds the export form again. After a wipe there is no
// one by that e-mail: ensureUser makes a new leaver.
func resetLeaver(ctx context.Context, db *pgxpool.Pool) error {
	_, err := db.Exec(ctx, `
WITH leaver AS (SELECT id FROM users WHERE email = 'leaver@seed.test'),
     cancelled AS (DELETE FROM account_deletions WHERE user_id IN (SELECT id FROM leaver) AND wiped_at IS NULL)
DELETE FROM data_exports WHERE user_id IN (SELECT id FROM leaver)`)
	return err
}

// ensureLeaver puts the leaver's sheet into a folder of theirs, which the gm gets with the sheet
// after the wipe, and gives them the delete_account token with a known plaintext.
func ensureLeaver(ctx context.Context, db *pgxpool.Pool, m models.Models, roomID int) (accountSeed, error) {
	var leaver *seedUser
	for _, u := range users {
		if u.Key == "leaver" {
			leaver = u
		}
	}
	out := accountSeed{DeleteToken: leaverDeleteToken}
	if err := db.QueryRow(ctx, `
INSERT INTO character_sheet_folders (owner_id, room_id, name) VALUES ($1, $2, 'Leaver''s folder') RETURNING id`,
		leaver.ID, roomID).Scan(&out.LeaverFolder); err != nil {
		return out, fmt.Errorf("folder: %w", err)
	}
	if _, err := db.Exec(ctx, `UPDATE character_sheets SET folder_id = $2 WHERE id = $1`, leaver.SheetID, out.LeaverFolder); err != nil {
		return out, fmt.Errorf("sheet into the folder: %w", err)
	}

	hash := sha256.Sum256([]byte(leaverDeleteToken))
	if _, err := db.Exec(ctx, `DELETE FROM tokens WHERE hash = $1`, hash[:]); err != nil {
		return out, err
	}
	// A real link lasts an hour; a seed is used later than that.
	err := m.Tokens.Insert(ctx, &models.Token{
		Plaintext: leaverDeleteToken,
		Hash:      hash[:],
		UserID:    leaver.ID,
		Expiry:    time.Now().Add(30 * 24 * time.Hour),
		Scope:     models.ScopeDeleteAccount,
	})
	return out, err
}
