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

// The mover's address and the one their email change of the seed leads to.
const (
	moverEmail    = "mover@seed.test"
	moverNewEmail = "mover-new@seed.test"
)

// The plaintexts of the mover's links, /account/email/{old,new,revert}/token/<it>, as the emails
// of an email change carry them.
const (
	moverOldToken    = "MOVERLINKTOOLDEMAILE2ETEST"
	moverNewToken    = "MOVERLINKTONEWEMAILE2ETEST"
	moverRevertToken = "MOVERLINKTOREVERTE2ETESTAA"
)

type accountSeed struct {
	// The plaintext of the leaver's delete_account token.
	DeleteToken string `json:"deleteToken"`
	// The leaver's folder in the room, with their sheet in it.
	LeaverFolder int `json:"leaverFolder"`
	// The mover's email change.
	Mover moverSeed `json:"mover"`
}

type moverSeed struct {
	// The plaintext of the link to the current address, of the change to NewEmail.
	OldToken string `json:"oldToken"`
	// The plaintext of the link to NewEmail.
	NewToken string `json:"newToken"`
	// The plaintext of the link that puts Email back.
	RevertToken string `json:"revertToken"`
	Email       string `json:"email"`
	NewEmail    string `json:"newEmail"`
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

// resetMover gives the mover back the address a failed scenario left changed: ensureUser finds the
// seeded users by email.
func resetMover(ctx context.Context, db *pgxpool.Pool) error {
	_, err := db.Exec(ctx, `UPDATE users SET email = $1 WHERE email = $2`, moverEmail, moverNewEmail)
	return err
}

// ensureMover gives the mover an email change to moverNewEmail with the links of both addresses,
// and a link that puts moverEmail back as if from an earlier change: the scenario changes the
// email by the first two and takes it back by the third, which ConfirmNewEmail keeps.
func ensureMover(ctx context.Context, m models.Models) (moverSeed, error) {
	var mover *seedUser
	for _, u := range users {
		if u.Key == "mover" {
			mover = u
		}
	}
	out := moverSeed{OldToken: moverOldToken, NewToken: moverNewToken, RevertToken: moverRevertToken, Email: moverEmail, NewEmail: moverNewEmail}
	// ensureUser dropped the mover's links of the last seed; real ones last a day or a week.
	for _, t := range []struct {
		plaintext string
		scope     models.TokenScope
		email     string
	}{
		{moverOldToken, models.ScopeChangeEmailOld, moverNewEmail},
		{moverNewToken, models.ScopeChangeEmailNew, moverNewEmail},
		{moverRevertToken, models.ScopeRevertEmail, moverEmail},
	} {
		hash := sha256.Sum256([]byte(t.plaintext))
		if err := m.Tokens.Insert(ctx, &models.Token{
			Plaintext: t.plaintext,
			Hash:      hash[:],
			UserID:    mover.ID,
			Expiry:    time.Now().Add(30 * 24 * time.Hour),
			Scope:     t.scope,
			Email:     t.email,
		}); err != nil {
			return out, fmt.Errorf("%s token: %w", t.scope, err)
		}
	}
	return out, nil
}
