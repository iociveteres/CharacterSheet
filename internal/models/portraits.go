package models

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PortraitMaxBytes is the largest image portrait_images takes (its CHECK).
const PortraitMaxBytes = 128 << 10

var ErrInvalidPortrait = errors.New("models: portrait is not a WebP or JPEG image of at most 128 KB")

type PortraitModelInterface interface {
	Get(ctx context.Context, userID int, hash string) (*Portrait, error)
	Put(ctx context.Context, userID, sheetID int, mime string, data []byte) (string, error)
	Delete(ctx context.Context, userID, sheetID int) error
}

type Portrait struct {
	Mime string
	Data []byte
}

type PortraitModel struct {
	DB *pgxpool.Pool
}

// Get is the image of `hash` if the user can view a sheet that links to it:
// all the copies of a sheet share the image and its cache in the browser. An
// image the user may not see is ErrNoRecord, as one that does not exist.
func (m *PortraitModel) Get(ctx context.Context, userID int, hash string) (*Portrait, error) {
	p := &Portrait{}
	err := m.DB.QueryRow(ctx, `
        SELECT p.mime, p.data
        FROM portrait_images p
        WHERE p.hash = $2
          AND EXISTS (SELECT 1 FROM sheet_portraits sp
                      WHERE sp.hash = p.hash AND can_view_character_sheet($1, sp.sheet_id))`,
		userID, hash).Scan(&p.Mime, &p.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

// Put makes `data` the portrait of the sheet and returns its hash. The image
// of an NPC or a creature counts in its owner's quota, once however many of
// their sheets link to it.
func (m *PortraitModel) Put(ctx context.Context, userID, sheetID int, mime string, data []byte) (string, error) {
	if (mime != "image/webp" && mime != "image/jpeg") || len(data) == 0 || len(data) > PortraitMaxBytes {
		return "", ErrInvalidPortrait
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])[:16]

	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var canEdit, gmSheet bool
	var ownerID int
	err = tx.QueryRow(ctx, `
        SELECT can_edit_character_sheet($1, id), encounter_id IS NOT NULL OR collection_id IS NOT NULL, owner_id
        FROM character_sheets WHERE id = $2`, userID, sheetID).Scan(&canEdit, &gmSheet, &ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNoRecord
	}
	if err != nil {
		return "", err
	}
	if !canEdit {
		return "", ErrPermissionDenied
	}

	var before int64
	if gmSheet {
		if before, err = lockQuota(ctx, tx, ownerID); err != nil {
			return "", err
		}
	}

	// DO UPDATE rather than DO NOTHING locks an existing image, so the
	// trigger of a link deleted meanwhile does not take it from under ours.
	if _, err := tx.Exec(ctx, `
        INSERT INTO portrait_images (hash, mime, data) VALUES ($1, $2, $3)
        ON CONFLICT (hash) DO UPDATE SET mime = portrait_images.mime`, hash, mime, data); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
        INSERT INTO sheet_portraits (sheet_id, hash) VALUES ($1, $2)
        ON CONFLICT (sheet_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()`, sheetID, hash); err != nil {
		return "", err
	}

	if gmSheet {
		if err := checkQuota(ctx, tx, ownerID, before); err != nil {
			return "", err
		}
	}
	return hash, tx.Commit(ctx)
}

// Delete removes the portrait of the sheet; the trigger of sheet_portraits
// deletes the image once no sheet links to it.
func (m *PortraitModel) Delete(ctx context.Context, userID, sheetID int) error {
	var canEdit bool
	err := m.DB.QueryRow(ctx, `SELECT can_edit_character_sheet($1, id) FROM character_sheets WHERE id = $2`,
		userID, sheetID).Scan(&canEdit)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNoRecord
	}
	if err != nil {
		return err
	}
	if !canEdit {
		return ErrPermissionDenied
	}
	_, err = m.DB.Exec(ctx, `DELETE FROM sheet_portraits WHERE sheet_id = $1`, sheetID)
	return err
}
