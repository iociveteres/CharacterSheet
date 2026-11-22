package models

import (
	"context"
	"time"
)

// PendingAccount is an account in its grace period, as the background job of the deletions sees
// it (plan _prd/account_deletion, section 7.2).
type PendingAccount struct {
	UserID int
	// For the reminder; Locale is "" when the user hasn't picked a language.
	Email, Name, Locale string
	DeleteAt            time.Time
	// When the reminder went out, nil before.
	RemindedAt *time.Time
}

// PendingAccounts are the accounts whose deletion is scheduled and not carried out yet. They are
// few, the users of three days: the job decides in Go which to remind and which to wipe.
func (m *UserModel) PendingAccounts(ctx context.Context) ([]PendingAccount, error) {
	rows, err := m.DB.Query(ctx, `
SELECT d.user_id, u.email, u.name, COALESCE(u.locale, ''), d.delete_at, d.reminded_at
FROM account_deletions d
JOIN users u ON u.id = d.user_id
WHERE d.wiped_at IS NULL
ORDER BY d.delete_at, d.user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var accounts []PendingAccount
	for rows.Next() {
		var a PendingAccount
		if err := rows.Scan(&a.UserID, &a.Email, &a.Name, &a.Locale, &a.DeleteAt, &a.RemindedAt); err != nil {
			return nil, err
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

// MarkReminded notes that the reminder of the pending deletion went out: the wipe waits a day
// after it. Nothing happens when the deletion was cancelled or carried out meanwhile.
func (m *UserModel) MarkReminded(ctx context.Context, userID int) error {
	_, err := m.DB.Exec(ctx, `UPDATE account_deletions SET reminded_at = now() WHERE user_id = $1 AND wiped_at IS NULL`, userID)
	return err
}

// HurryDeletion moves the pending deletion and its reminder two days back, so that the next pass
// of the job wipes the account: for e2e only, through the -dev route /dev/account-jobs/run.
// ErrNoRecord when no deletion is pending.
func (m *UserModel) HurryDeletion(ctx context.Context, userID int) error {
	tag, err := m.DB.Exec(ctx, `
UPDATE account_deletions
SET delete_at = now() - interval '2 days', reminded_at = now() - interval '2 days'
WHERE user_id = $1 AND wiped_at IS NULL`, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNoRecord
	}
	return nil
}
