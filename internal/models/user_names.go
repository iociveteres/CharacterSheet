package models

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// NameChange is a former name of a user and when it was left.
type NameChange struct {
	Name      string    `json:"name"`
	ChangedAt time.Time `json:"changedAt"`
}

// Rename gives a confirmed account a new name, in one transaction with the former name written to
// its history (plan _prd/account_name_email, section 3). The same name in another case replaces it
// without a history row, the same name exactly changes nothing. The name is stored as given: the
// caller trims and checks it. ErrDuplicateName for a name of another account regardless of case,
// ErrNoRecord for no such confirmed account.
func (m *UserModel) Rename(ctx context.Context, id int, name string) error {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var old string
	var sameName bool
	// Compared as users_name_key compares them.
	err = tx.QueryRow(ctx, `
SELECT name, lower(name COLLATE "und-x-icu") = lower($2::text COLLATE "und-x-icu")
FROM users
WHERE id = $1 AND status = 'email_verified'
FOR UPDATE`, id, name).Scan(&old, &sameName)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNoRecord
	}
	if err != nil {
		return err
	}
	if old == name {
		return nil
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET name = $2 WHERE id = $1`, id, name); err != nil {
		return duplicateUser(err)
	}
	if !sameName {
		if _, err := tx.Exec(ctx, `INSERT INTO user_name_history (user_id, name) VALUES ($1, $2)`, id, old); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// NameHistory is the last limit former names of the user, the latest first; all of them for a
// limit of 0.
func (m *UserModel) NameHistory(ctx context.Context, id int, limit int) ([]NameChange, error) {
	rows, err := m.DB.Query(ctx, `
SELECT name, changed_at
FROM user_name_history
WHERE user_id = $1
ORDER BY changed_at DESC, id DESC
LIMIT NULLIF($2::int, 0)`, id, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[NameChange])
}
