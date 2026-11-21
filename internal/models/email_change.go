package models

import (
	"cmp"
	"context"
	"crypto/sha256"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// The email change of plan _prd/account_name_email, sections 4 and 5: a change in progress is a
// live change_email_* token carrying the new address; after the change a revert_email token keeps
// the old address for a week.
const (
	// EmailChangeTTL is how long the links to the old and to the new address hold.
	EmailChangeTTL = 24 * time.Hour
	// EmailRevertTTL is how long the link that puts the old address back holds.
	EmailRevertTTL = 7 * 24 * time.Hour
)

// EmailChanged is a change of email just made: the letter with the revert link goes to OldEmail.
type EmailChanged struct {
	UserID      int
	OldEmail    string
	NewEmail    string
	RevertToken string
}

// emailTaken tells whether the address is the email of an account, userID's own included, or is
// kept by a live revert link of anyone but userID: the revert must find the address free.
func emailTaken(ctx context.Context, tx pgx.Tx, email string, userID int) (bool, error) {
	var taken bool
	err := tx.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)
    OR EXISTS (SELECT 1 FROM tokens WHERE scope = $3 AND email = $1 AND user_id <> $2 AND expiry > now())`,
		email, userID, ScopeRevertEmail).Scan(&taken)
	return taken, err
}

func insertToken(ctx context.Context, tx pgx.Tx, userID int, ttl time.Duration, scope TokenScope, email string) (*Token, error) {
	token, err := generateToken(userID, ttl, scope)
	if err != nil {
		return nil, err
	}
	token.Email = email
	_, err = tx.Exec(ctx, `INSERT INTO tokens (hash, user_id, expiry, scope, email) VALUES ($1, $2, $3, $4, NULLIF($5, ''))`,
		token.Hash, token.UserID, token.Expiry, token.Scope, token.Email)
	return token, err
}

// consumeToken uses up a live token of the scope whose user has one of the statuses, returning the
// user and the address of the token; ErrNoRecord for none.
func consumeToken(ctx context.Context, tx pgx.Tx, tokenPlaintext string, scope TokenScope, statuses ...userStatus) (int, string, error) {
	hash := sha256.Sum256([]byte(tokenPlaintext))
	var userID int
	var email string
	err := tx.QueryRow(ctx, `
DELETE FROM tokens t
USING users u
WHERE t.hash = $1 AND t.scope = $2 AND t.expiry > now() AND u.id = t.user_id AND u.status::text = ANY($3)
RETURNING t.user_id, COALESCE(t.email, '')`, hash[:], scope, statuses).Scan(&userID, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", ErrNoRecord
	}
	return userID, email, err
}

func deleteTokens(ctx context.Context, tx pgx.Tx, userID int, scopes ...TokenScope) error {
	_, err := tx.Exec(ctx, `DELETE FROM tokens WHERE user_id = $1 AND scope::text = ANY($2)`, userID, scopes)
	return err
}

// RequestEmailChange starts changing the email of a confirmed account to newEmail, whose format
// the caller checks. A change in progress is dropped. It returns the token of the link to the
// current address. ErrInvalidCredentials for a wrong password, ErrDuplicateEmail for an address
// taken (see emailTaken: the current one too), ErrNoRecord for no such confirmed account.
func (m *UserModel) RequestEmailChange(ctx context.Context, id int, password, newEmail string) (*Token, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var hashedPassword []byte
	err = tx.QueryRow(ctx, `SELECT hashed_password FROM users WHERE id = $1 AND status = 'email_verified' FOR UPDATE`, id).Scan(&hashedPassword)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoRecord
	}
	if err != nil {
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword(hashedPassword, []byte(password)); err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return nil, ErrInvalidCredentials
		}
		return nil, err
	}
	if taken, err := emailTaken(ctx, tx, newEmail, id); err != nil || taken {
		return nil, cmp.Or(err, ErrDuplicateEmail)
	}
	if err := deleteTokens(ctx, tx, id, ScopeChangeEmailOld, ScopeChangeEmailNew); err != nil {
		return nil, err
	}
	token, err := insertToken(ctx, tx, id, EmailChangeTTL, ScopeChangeEmailOld, newEmail)
	if err != nil {
		return nil, err
	}
	return token, tx.Commit(ctx)
}

// ConfirmOldEmail uses up the token of the link to the current address and returns the token of
// the link to the new one, whose Email is that address. ErrNoRecord for a token used, expired or
// of an account no longer confirmed.
func (m *UserModel) ConfirmOldEmail(ctx context.Context, tokenPlaintext string) (*Token, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	userID, newEmail, err := consumeToken(ctx, tx, tokenPlaintext, ScopeChangeEmailOld, statusEmailVerified)
	if err != nil {
		return nil, err
	}
	token, err := insertToken(ctx, tx, userID, EmailChangeTTL, ScopeChangeEmailNew, newEmail)
	if err != nil {
		return nil, err
	}
	return token, tx.Commit(ctx)
}

// ConfirmNewEmail uses up the token of the link to the new address and changes the email to it.
// The links of the change and of password resets, which went to the old address, are dropped; a
// revert link for the old address is made, and those of earlier changes stay, so that the first
// address of a chain can still take the account back. ErrDuplicateEmail when the address was
// taken since the request: the change is dropped then. ErrNoRecord as in ConfirmOldEmail.
func (m *UserModel) ConfirmNewEmail(ctx context.Context, tokenPlaintext string) (*EmailChanged, error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	userID, newEmail, err := consumeToken(ctx, tx, tokenPlaintext, ScopeChangeEmailNew, statusEmailVerified)
	if err != nil {
		return nil, err
	}
	c := &EmailChanged{UserID: userID, NewEmail: newEmail}
	if err := tx.QueryRow(ctx, `SELECT email FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&c.OldEmail); err != nil {
		return nil, err
	}
	taken, err := emailTaken(ctx, tx, newEmail, userID)
	if err != nil {
		return nil, err
	}
	if taken {
		// The change can't be finished: the account page shouldn't show it as pending.
		if err := deleteTokens(ctx, tx, userID, ScopeChangeEmailOld, ScopeChangeEmailNew); err != nil {
			return nil, err
		}
		return nil, cmp.Or(tx.Commit(ctx), ErrDuplicateEmail)
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET email = $2 WHERE id = $1`, userID, newEmail); err != nil {
		return nil, duplicateUser(err)
	}
	if err := deleteTokens(ctx, tx, userID, ScopeChangeEmailOld, ScopeChangeEmailNew, ScopeChangePassword); err != nil {
		return nil, err
	}
	revert, err := insertToken(ctx, tx, userID, EmailRevertTTL, ScopeRevertEmail, c.OldEmail)
	if err != nil {
		return nil, err
	}
	c.RevertToken = revert.Plaintext
	return c, tx.Commit(ctx)
}

// RevertEmail uses up a revert link and puts its address back as the email, also for an account
// in its grace period before the wipe. Every link of email changes, reverts and password resets
// of the account is dropped, the revert links of later changes too: whoever made them can't revert
// the revert. It returns the account and the address put back; the caller closes its sessions.
// ErrNoRecord for a token used or expired.
func (m *UserModel) RevertEmail(ctx context.Context, tokenPlaintext string) (userID int, email string, err error) {
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return 0, "", err
	}
	defer tx.Rollback(ctx)

	userID, email, err = consumeToken(ctx, tx, tokenPlaintext, ScopeRevertEmail, statusEmailVerified, statusDeleting)
	if err != nil {
		return 0, "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET email = $2 WHERE id = $1`, userID, email); err != nil {
		return 0, "", duplicateUser(err)
	}
	if err := deleteTokens(ctx, tx, userID, ScopeChangeEmailOld, ScopeChangeEmailNew, ScopeRevertEmail, ScopeChangePassword); err != nil {
		return 0, "", err
	}
	return userID, email, tx.Commit(ctx)
}

// PendingEmailChange is the new address of the user's change in progress, "" for none.
func (m *UserModel) PendingEmailChange(ctx context.Context, id int) (string, error) {
	var email string
	err := m.DB.QueryRow(ctx, `
SELECT email FROM tokens
WHERE user_id = $1 AND scope::text = ANY($2) AND expiry > now()
ORDER BY expiry DESC
LIMIT 1`, id, []TokenScope{ScopeChangeEmailOld, ScopeChangeEmailNew}).Scan(&email)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return email, err
}

// CancelEmailChange drops the user's change in progress: its links stop working.
func (m *UserModel) CancelEmailChange(ctx context.Context, id int) error {
	_, err := m.DB.Exec(ctx, `DELETE FROM tokens WHERE user_id = $1 AND scope::text = ANY($2)`,
		id, []TokenScope{ScopeChangeEmailOld, ScopeChangeEmailNew})
	return err
}
