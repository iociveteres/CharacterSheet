package models

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AvatarMaxBytes is the largest image user_avatars takes (its CHECK).
const AvatarMaxBytes = 64 << 10

var (
	ErrInvalidAvatar = errors.New("models: avatar is not a WebP or JPEG image of at most 64 KB")
	// ErrAvatarLocked: a moderator removed the user's avatar and locked uploading a new one.
	ErrAvatarLocked = errors.New("models: the user may not upload an avatar")
)

type AvatarModelInterface interface {
	Get(ctx context.Context, hash string) (*Avatar, error)
	Hashes(ctx context.Context, userIDs []int) (map[int]string, error)
	Put(ctx context.Context, userID int, mime string, data []byte) (string, error)
	Delete(ctx context.Context, userID int) error
	Remove(ctx context.Context, userID int, lock *AvatarLock) error
	Unlock(ctx context.Context, userID int) error
	LockOf(ctx context.Context, userID int) (*AvatarLock, error)
	Locks(ctx context.Context) ([]AvatarLock, error)
}

type Avatar struct {
	Mime string
	Data []byte
}

// AvatarLock forbids the user to upload an avatar until Until, for good when it is nil.
type AvatarLock struct {
	UserID      int
	Until       *time.Time
	Reason      string
	ModeratorID int
	CreatedAt   time.Time
}

type AvatarModel struct {
	DB *pgxpool.Pool
}

// A lock holds while its until is ahead: an expired one stays in the table, ignored.
const lockHolds = `(until IS NULL OR until > now())`

// Get is the image of `hash`, whoever asks: avatars are public.
func (m *AvatarModel) Get(ctx context.Context, hash string) (*Avatar, error) {
	a := &Avatar{}
	// Two users with the same image share its hash; either row has the same data.
	err := m.DB.QueryRow(ctx, `SELECT mime, data FROM user_avatars WHERE hash = $1 LIMIT 1`, hash).Scan(&a.Mime, &a.Data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

// Hashes is the hash of each user's avatar; a user without one is not in the map.
func (m *AvatarModel) Hashes(ctx context.Context, userIDs []int) (map[int]string, error) {
	hashes := map[int]string{}
	if len(userIDs) == 0 {
		return hashes, nil
	}
	rows, err := m.DB.Query(ctx, `SELECT user_id, hash FROM user_avatars WHERE user_id = ANY($1)`, userIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var hash string
		if err := rows.Scan(&id, &hash); err != nil {
			return nil, err
		}
		hashes[id] = hash
	}
	return hashes, rows.Err()
}

// lockUser serialises the avatar changes of one user, so that an upload
// cannot slip in between a moderator's removal and their lock.
func lockUser(ctx context.Context, tx pgx.Tx, userID int) error {
	var id int
	err := tx.QueryRow(ctx, `SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNoRecord
	}
	return err
}

// Put makes `data` the user's avatar and returns its hash; ErrAvatarLocked
// while a moderator's lock holds.
func (m *AvatarModel) Put(ctx context.Context, userID int, mime string, data []byte) (string, error) {
	if (mime != "image/webp" && mime != "image/jpeg") || len(data) == 0 || len(data) > AvatarMaxBytes {
		return "", ErrInvalidAvatar
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])[:16]

	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if err := lockUser(ctx, tx, userID); err != nil {
		return "", err
	}
	var locked bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM user_avatar_locks WHERE user_id = $1 AND `+lockHolds+`)`,
		userID).Scan(&locked); err != nil {
		return "", err
	}
	if locked {
		return "", ErrAvatarLocked
	}
	if _, err := tx.Exec(ctx, `
        INSERT INTO user_avatars (user_id, hash, mime, data) VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE
        SET hash = EXCLUDED.hash, mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`,
		userID, hash, mime, data); err != nil {
		return "", err
	}
	return hash, tx.Commit(ctx)
}

// Delete removes the user's avatar, if any: the image is not kept.
func (m *AvatarModel) Delete(ctx context.Context, userID int) error {
	_, err := m.DB.Exec(ctx, `DELETE FROM user_avatars WHERE user_id = $1`, userID)
	return err
}

// Remove is a moderator's removal of the user's avatar: it deletes the image
// and, with a lock, forbids a new one, replacing an earlier lock. Repeating it
// is safe.
func (m *AvatarModel) Remove(ctx context.Context, userID int, lock *AvatarLock) error {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockUser(ctx, tx, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM user_avatars WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if lock != nil {
		if _, err := tx.Exec(ctx, `
            INSERT INTO user_avatar_locks (user_id, until, reason, moderator_id) VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id) DO UPDATE
            SET until = EXCLUDED.until, reason = EXCLUDED.reason, moderator_id = EXCLUDED.moderator_id, created_at = now()`,
			userID, lock.Until, lock.Reason, lock.ModeratorID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Unlock lifts the user's lock, if any.
func (m *AvatarModel) Unlock(ctx context.Context, userID int) error {
	_, err := m.DB.Exec(ctx, `DELETE FROM user_avatar_locks WHERE user_id = $1`, userID)
	return err
}

const avatarLockColumns = `user_id, until, reason, moderator_id, created_at`

func scanAvatarLock(row pgx.Row) (AvatarLock, error) {
	var l AvatarLock
	err := row.Scan(&l.UserID, &l.Until, &l.Reason, &l.ModeratorID, &l.CreatedAt)
	return l, err
}

// LockOf is the user's lock while it holds, nil without one.
func (m *AvatarModel) LockOf(ctx context.Context, userID int) (*AvatarLock, error) {
	l, err := scanAvatarLock(m.DB.QueryRow(ctx,
		`SELECT `+avatarLockColumns+` FROM user_avatar_locks WHERE user_id = $1 AND `+lockHolds, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// Locks are the locks that hold, the latest first.
func (m *AvatarModel) Locks(ctx context.Context) ([]AvatarLock, error) {
	rows, err := m.DB.Query(ctx,
		`SELECT `+avatarLockColumns+` FROM user_avatar_locks WHERE `+lockHolds+` ORDER BY created_at DESC, user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var locks []AvatarLock
	for rows.Next() {
		l, err := scanAvatarLock(rows)
		if err != nil {
			return nil, err
		}
		locks = append(locks, l)
	}
	return locks, rows.Err()
}
