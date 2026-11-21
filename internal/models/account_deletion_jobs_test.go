package models

import (
	"errors"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
)

// The job sees the pending deletions only, with what the reminder needs; a wiped row is not
// taken again (plan _prd/account_deletion, section 9).
func TestPendingAccounts(t *testing.T) {
	d := newWipeDB(t)
	leaver, wiped, _ := d.user("leaver"), d.user("wiped"), d.user("stayer")
	d.schedule(leaver, false, false, false, nil)
	d.schedule(wiped, false, false, false, nil)
	d.exec(`UPDATE users SET locale = 'ru' WHERE id = $1`, leaver)
	d.wipe(wiped)
	m := UserModel{DB: d.db}

	accounts, err := m.PendingAccounts(d.ctx)
	assert.NilError(t, err)
	if len(accounts) != 1 {
		t.Fatalf("pending accounts %+v, want the leaver's only", accounts)
	}
	a := accounts[0]
	assert.Equal(t, a.UserID, leaver)
	assert.Equal(t, a.Email, "leaver@example.com")
	assert.Equal(t, a.Name, "leaver")
	assert.Equal(t, a.Locale, "ru")
	if a.RemindedAt != nil {
		t.Errorf("reminded at %v before the reminder", a.RemindedAt)
	}

	assert.NilError(t, m.MarkReminded(d.ctx, leaver))
	accounts, err = m.PendingAccounts(d.ctx)
	assert.NilError(t, err)
	if len(accounts) != 1 || accounts[0].RemindedAt == nil || time.Since(*accounts[0].RemindedAt) > time.Minute {
		t.Errorf("pending accounts %+v, want the leaver reminded now", accounts)
	}
}

// The -dev route makes the deletion due a day after the reminder.
func TestHurryDeletion(t *testing.T) {
	d := newWipeDB(t)
	leaver, stayer := d.user("leaver"), d.user("stayer")
	d.schedule(leaver, false, false, false, nil)
	d.exec(`UPDATE account_deletions SET delete_at = now() + interval '3 days' WHERE user_id = $1`, leaver)
	m := UserModel{DB: d.db}

	assert.NilError(t, m.HurryDeletion(d.ctx, leaver))
	if !d.exists(`SELECT 1 FROM account_deletions WHERE user_id = $1
	AND delete_at < now() - interval '1 day' AND reminded_at < now() - interval '1 day'`, leaver) {
		t.Error("the deletion and its reminder are not two days back")
	}
	if err := m.HurryDeletion(d.ctx, stayer); !errors.Is(err, ErrNoRecord) {
		t.Errorf("hurry without a deletion: %v", err)
	}
	d.wipe(leaver)
	if err := m.HurryDeletion(d.ctx, leaver); !errors.Is(err, ErrNoRecord) {
		t.Errorf("hurry after the wipe: %v", err)
	}
}
