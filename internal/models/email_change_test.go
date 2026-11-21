package models

import (
	"errors"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"golang.org/x/crypto/bcrypt"
)

// emailUser is a confirmed account <name>@example.com with the password "pa$$word".
func (d *wipeDB) emailUser(name string) int {
	d.t.Helper()
	id := d.user(name)
	hash, err := bcrypt.GenerateFromPassword([]byte("pa$$word"), bcrypt.MinCost)
	if err != nil {
		d.t.Fatal(err)
	}
	d.exec(`UPDATE users SET hashed_password = $2 WHERE id = $1`, id, hash)
	return id
}

func (d *wipeDB) email(id int) string {
	d.t.Helper()
	return d.text(`SELECT email FROM users WHERE id = $1`, id)
}

func (d *wipeDB) tokens(id int, scope TokenScope) int {
	d.t.Helper()
	return d.int(`SELECT count(*) FROM tokens WHERE user_id = $1 AND scope = $2`, id, scope)
}

// changeEmail runs the whole change of the user's email to newEmail and returns the revert token.
func changeEmail(t *testing.T, m UserModel, id int, newEmail string) *EmailChanged {
	t.Helper()
	old, err := m.RequestEmailChange(t.Context(), id, "pa$$word", newEmail)
	assert.NilError(t, err)
	next, err := m.ConfirmOldEmail(t.Context(), old.Plaintext)
	assert.NilError(t, err)
	changed, err := m.ConfirmNewEmail(t.Context(), next.Plaintext)
	assert.NilError(t, err)
	return changed
}

func TestEmailChange(t *testing.T) {
	d := newWipeDB(t)
	ivan, bob := d.emailUser("ivan"), d.emailUser("bob")
	m, tokens := UserModel{DB: d.db}, TokenModel{DB: d.db}

	if _, err := m.RequestEmailChange(d.ctx, ivan, "wrong", "new@example.com"); !errors.Is(err, ErrInvalidCredentials) {
		t.Errorf("wrong password: %v", err)
	}
	for _, taken := range []string{"bob@example.com", "ivan@example.com"} {
		if _, err := m.RequestEmailChange(d.ctx, ivan, "pa$$word", taken); !errors.Is(err, ErrDuplicateEmail) {
			t.Errorf("%s: got %v, want ErrDuplicateEmail", taken, err)
		}
	}

	first, err := m.RequestEmailChange(d.ctx, ivan, "pa$$word", "first@example.com")
	assert.NilError(t, err)
	assert.Equal(t, first.Email, "first@example.com")
	if time.Until(first.Expiry) < EmailChangeTTL-time.Minute {
		t.Errorf("expiry %v", first.Expiry)
	}
	// A new request drops the one in progress.
	old, err := m.RequestEmailChange(d.ctx, ivan, "pa$$word", "new@example.com")
	assert.NilError(t, err)
	if _, err := m.ConfirmOldEmail(d.ctx, first.Plaintext); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the dropped request's link: %v", err)
	}
	pending, err := m.PendingEmailChange(d.ctx, ivan)
	assert.NilError(t, err)
	assert.Equal(t, pending, "new@example.com")
	pending, err = m.PendingEmailChange(d.ctx, bob)
	assert.NilError(t, err)
	assert.Equal(t, pending, "")

	if _, err := m.ConfirmNewEmail(d.ctx, old.Plaintext); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the old address's link at the new one's step: %v", err)
	}
	shown, err := tokens.Email(d.ctx, ScopeChangeEmailOld, old.Plaintext)
	assert.NilError(t, err)
	assert.Equal(t, shown, "new@example.com")
	if _, err := tokens.Email(d.ctx, ScopeChangeEmailNew, old.Plaintext); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the old address's link looked up in another scope: %v", err)
	}
	next, err := m.ConfirmOldEmail(d.ctx, old.Plaintext)
	assert.NilError(t, err)
	assert.Equal(t, next.Email, "new@example.com")
	if _, err := tokens.Email(d.ctx, ScopeChangeEmailOld, old.Plaintext); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a used link looked up: %v", err)
	}
	if _, err := m.ConfirmOldEmail(d.ctx, old.Plaintext); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the old address's link twice: %v", err)
	}
	assert.Equal(t, d.email(ivan), "ivan@example.com")
	pending, err = m.PendingEmailChange(d.ctx, ivan)
	assert.NilError(t, err)
	assert.Equal(t, pending, "new@example.com")

	_, err = tokens.New(d.ctx, ivan, time.Hour, ScopeChangePassword)
	assert.NilError(t, err)
	changed, err := m.ConfirmNewEmail(d.ctx, next.Plaintext)
	assert.NilError(t, err)
	if changed.UserID != ivan || changed.OldEmail != "ivan@example.com" || changed.NewEmail != "new@example.com" || changed.RevertToken == "" {
		t.Errorf("changed %+v", changed)
	}
	assert.Equal(t, d.email(ivan), "new@example.com")
	pending, err = m.PendingEmailChange(d.ctx, ivan)
	assert.NilError(t, err)
	assert.Equal(t, pending, "")
	// The reset link went to the old address.
	assert.Equal(t, d.tokens(ivan, ScopeChangePassword), 0)
	assert.Equal(t, d.text(`SELECT email FROM tokens WHERE user_id = $1 AND scope = $2 AND expiry > now() + interval '6 days'`,
		ivan, ScopeRevertEmail), "ivan@example.com")
	if _, err := m.ConfirmNewEmail(d.ctx, next.Plaintext); !errors.Is(err, ErrNoRecord) {
		t.Errorf("the new address's link twice: %v", err)
	}
}

func TestEmailChangeCancel(t *testing.T) {
	d := newWipeDB(t)
	ivan := d.emailUser("ivan")
	m := UserModel{DB: d.db}

	old, err := m.RequestEmailChange(d.ctx, ivan, "pa$$word", "new@example.com")
	assert.NilError(t, err)
	assert.NilError(t, m.CancelEmailChange(d.ctx, ivan))
	pending, err := m.PendingEmailChange(d.ctx, ivan)
	assert.NilError(t, err)
	assert.Equal(t, pending, "")
	if _, err := m.ConfirmOldEmail(d.ctx, old.Plaintext); !errors.Is(err, ErrNoRecord) {
		t.Errorf("a cancelled change's link: %v", err)
	}
}

func TestEmailTakenAtLastStep(t *testing.T) {
	d := newWipeDB(t)
	ivan := d.emailUser("ivan")
	m := UserModel{DB: d.db}

	old, err := m.RequestEmailChange(d.ctx, ivan, "pa$$word", "new@example.com")
	assert.NilError(t, err)
	next, err := m.ConfirmOldEmail(d.ctx, old.Plaintext)
	assert.NilError(t, err)
	// Someone signed up with the address in the meantime.
	_, err = m.Insert(d.ctx, "new", "new@example.com", "pa$$word", "")
	assert.NilError(t, err)

	if _, err := m.ConfirmNewEmail(d.ctx, next.Plaintext); !errors.Is(err, ErrDuplicateEmail) {
		t.Fatalf("got %v, want ErrDuplicateEmail", err)
	}
	assert.Equal(t, d.email(ivan), "ivan@example.com")
	pending, err := m.PendingEmailChange(d.ctx, ivan)
	assert.NilError(t, err)
	assert.Equal(t, pending, "")
	assert.Equal(t, d.tokens(ivan, ScopeRevertEmail), 0)
}

// A → B → C, then the revert link sent to A puts A back and kills the one sent to B.
func TestRevertEmailChain(t *testing.T) {
	d := newWipeDB(t)
	ivan, bob := d.emailUser("ivan"), d.emailUser("bob")
	m, tokens := UserModel{DB: d.db}, TokenModel{DB: d.db}

	toB := changeEmail(t, m, ivan, "b@example.com")
	toC := changeEmail(t, m, ivan, "c@example.com")
	assert.Equal(t, toC.OldEmail, "b@example.com")
	assert.Equal(t, d.email(ivan), "c@example.com")

	// A and B are kept for ivan while their revert links live: nobody else may take them.
	for _, kept := range []string{"ivan@example.com", "b@example.com"} {
		if _, err := m.Insert(d.ctx, "x"+kept, kept, "pa$$word", ""); !errors.Is(err, ErrDuplicateEmail) {
			t.Errorf("sign up with %s: got %v, want ErrDuplicateEmail", kept, err)
		}
		if _, err := m.RequestEmailChange(d.ctx, bob, "pa$$word", kept); !errors.Is(err, ErrDuplicateEmail) {
			t.Errorf("bob's change to %s: got %v, want ErrDuplicateEmail", kept, err)
		}
	}
	// But ivan may go back to one of them.
	_, err := m.RequestEmailChange(d.ctx, ivan, "pa$$word", "b@example.com")
	assert.NilError(t, err)

	_, err = tokens.New(d.ctx, ivan, time.Hour, ScopeChangePassword)
	assert.NilError(t, err)
	// The revert works in the grace period before the wipe too, and leaves it be.
	d.exec(`UPDATE users SET status = 'deleting' WHERE id = $1`, ivan)
	id, email, err := m.RevertEmail(d.ctx, toB.RevertToken)
	assert.NilError(t, err)
	assert.Equal(t, id, ivan)
	assert.Equal(t, email, "ivan@example.com")
	assert.Equal(t, d.email(ivan), "ivan@example.com")
	assert.Equal(t, d.text(`SELECT status::text FROM users WHERE id = $1`, ivan), string(statusDeleting))
	assert.Equal(t, d.int(`SELECT count(*) FROM tokens WHERE user_id = $1`, ivan), 0)
	if _, _, err := m.RevertEmail(d.ctx, toC.RevertToken); !errors.Is(err, ErrNoRecord) {
		t.Errorf("B's revert link after A's: %v", err)
	}
	// B's reserve went with its link.
	_, err = m.Insert(d.ctx, "b", "b@example.com", "pa$$word", "")
	assert.NilError(t, err)
}

func TestEmailChangeExpiredTokens(t *testing.T) {
	d := newWipeDB(t)
	ivan := d.emailUser("ivan")
	m, tokens := UserModel{DB: d.db}, TokenModel{DB: d.db}
	expired := func(scope TokenScope, email string) string {
		t.Helper()
		token, err := generateToken(ivan, -time.Minute, scope)
		assert.NilError(t, err)
		token.Email = email
		assert.NilError(t, tokens.Insert(d.ctx, token))
		return token.Plaintext
	}

	if _, err := m.ConfirmOldEmail(d.ctx, expired(ScopeChangeEmailOld, "new@example.com")); !errors.Is(err, ErrNoRecord) {
		t.Errorf("expired old address's link: %v", err)
	}
	if _, err := m.ConfirmNewEmail(d.ctx, expired(ScopeChangeEmailNew, "new@example.com")); !errors.Is(err, ErrNoRecord) {
		t.Errorf("expired new address's link: %v", err)
	}
	pending, err := m.PendingEmailChange(d.ctx, ivan)
	assert.NilError(t, err)
	assert.Equal(t, pending, "")
	if _, err := tokens.Email(d.ctx, ScopeChangeEmailOld, expired(ScopeChangeEmailOld, "new@example.com")); !errors.Is(err, ErrNoRecord) {
		t.Errorf("an expired link looked up: %v", err)
	}
	if _, _, err := m.RevertEmail(d.ctx, expired(ScopeRevertEmail, "gone@example.com")); !errors.Is(err, ErrNoRecord) {
		t.Errorf("expired revert link: %v", err)
	}
	assert.Equal(t, d.email(ivan), "ivan@example.com")
	// An expired revert link keeps nothing.
	_, err = m.Insert(d.ctx, "gone", "gone@example.com", "pa$$word", "")
	assert.NilError(t, err)
}
