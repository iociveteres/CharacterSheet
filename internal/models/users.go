package models

import (
	"context"
	"crypto/sha256"
	"errors"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"golang.org/x/crypto/bcrypt"
)

type UserModelInterface interface {
	Insert(ctx context.Context, name, email, password, locale string) (int, error)
	Authenticate(ctx context.Context, email, password string) (int, error)
	Exists(ctx context.Context, id int) (bool, error)
	GetLocale(ctx context.Context, id int) (string, error)
	SetLocale(ctx context.Context, id int, locale string) error
	Get(ctx context.Context, id int) (*User, error)
	GetByEmail(ctx context.Context, email string) (*User, error)
	PasswordUpdate(ctx context.Context, id int, currentPassword, newPassword string) error
	PasswordReset(ctx context.Context, tokenPlaintext string, newPassword string) (int, error)
	ActivateForToken(ctx context.Context, tokenScope TokenScope, tokenPlaintext string) (int, error)
	DeletionSummary(ctx context.Context, userID int) (*DeletionSummary, error)
	ScheduleDeletion(ctx context.Context, userID int, tokenPlaintext string, choices DeletionChoices) (*ScheduledDeletion, error)
	PendingDeletion(ctx context.Context, userID int) (time.Time, error)
	CancelDeletion(ctx context.Context, userID int) error
	Wipe(ctx context.Context, userID int) (*WipedAccount, error)
	DeletePending(ctx context.Context, olderThan time.Duration) (int64, error)
}

type userStatus string

const (
	statusPending       userStatus = "pending"
	statusEmailVerified userStatus = "email_verified"
	// In the grace period after the user scheduled the deletion.
	statusDeleting userStatus = "deleting"
	// The wiped tombstone row (plan: _prd/account_deletion, section 3).
	statusDeleted userStatus = "deleted"
)

type User struct {
	ID             int
	Name           string
	Email          string
	HashedPassword []byte
	CreatedAt      time.Time
	Status         userStatus
	// Locale is "" when the user hasn't picked a language.
	Locale string
}

type UserModel struct {
	DB *pgxpool.Pool
}

// Insert saves locale as the user's language, "" for none.
func (m *UserModel) Insert(ctx context.Context, name, email, password, locale string) (int, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return 0, err
	}

	const stmt = `
INSERT INTO users (name, email, hashed_password, locale, created_at)
VALUES ($1, $2, $3, NULLIF($4, ''), CURRENT_TIMESTAMP)
RETURNING id`

	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var id int
	err = tx.QueryRow(ctx, stmt, name, email, string(hashedPassword), locale).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if pgErr.Code == pgerrcode.UniqueViolation && pgErr.ConstraintName == "users_email_key" {
				return 0, ErrDuplicateEmail
			}
		}
		return 0, err
	}
	// Every user has a default collection in the bestiary from the start,
	// named in their language: it is known by is_default, not by the name.
	_, err = tx.Exec(ctx, `INSERT INTO bestiary_collections (owner_id, name, is_default) VALUES ($1, $2, true)`, id, i18n.T(locale, "bestiary.shared.defaultCollection"))
	if err != nil {
		return 0, err
	}

	return id, tx.Commit(ctx)
}

// Authenticate returns the id of the user with the email and password. The password is checked
// before the status, so that only the right one learns of it: ErrUserNotActivated for an account
// whose email is not confirmed, ErrDeletionScheduled for one in its grace period before the wipe,
// both with the id.
func (m *UserModel) Authenticate(ctx context.Context, email, password string) (int, error) {
	const stmt = `
SELECT id, hashed_password, status
  FROM users
 WHERE email = $1 AND status <> 'deleted'`

	var id int
	var hashedPassword []byte
	var status userStatus

	err := m.DB.QueryRow(ctx, stmt, email).Scan(&id, &hashedPassword, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrInvalidCredentials
		} else {
			return 0, err
		}
	}

	err = bcrypt.CompareHashAndPassword(hashedPassword, []byte(password))
	if err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return 0, ErrInvalidCredentials
		} else {
			return 0, err
		}
	}
	switch status {
	case statusEmailVerified:
		return id, nil
	case statusDeleting:
		return id, ErrDeletionScheduled
	default:
		return id, ErrUserNotActivated
	}
}

// Check if a user with a specific ID exists.
func (m *UserModel) Exists(ctx context.Context, id int) (bool, error) {
	const stmt = `
SELECT EXISTS(
    SELECT 1
      FROM users
     WHERE id = $1 AND status <> 'deleted'
)`
	var exists bool
	err := m.DB.QueryRow(ctx, stmt, id).Scan(&exists)
	return exists, err
}

// GetLocale returns the language the user picked, "" if none, or ErrNoRecord: the web app
// checks the session's user with it on every request instead of Exists. Only a confirmed account
// is found, so a session left of an account in its grace period or of a tombstone is a guest's.
func (m *UserModel) GetLocale(ctx context.Context, id int) (string, error) {
	var locale *string
	err := m.DB.QueryRow(ctx, `SELECT locale FROM users WHERE id = $1 AND status = 'email_verified'`, id).Scan(&locale)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNoRecord
	}
	if err != nil || locale == nil {
		return "", err
	}
	return *locale, nil
}

func (m *UserModel) SetLocale(ctx context.Context, id int, locale string) error {
	_, err := m.DB.Exec(ctx, `UPDATE users SET locale = $1 WHERE id = $2`, locale, id)
	return err
}

func (m *UserModel) Get(ctx context.Context, id int) (*User, error) {
	const stmt = `
SELECT id, name, email, created_at, COALESCE(locale, '')
  FROM users
 WHERE id = $1 AND status <> 'deleted'`

	row := m.DB.QueryRow(ctx, stmt, id)

	u := &User{}
	err := row.Scan(
		&u.ID,
		&u.Name,
		&u.Email,
		&u.CreatedAt,
		&u.Locale,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}
	return u, nil
}

func (m *UserModel) GetByEmail(ctx context.Context, email string) (*User, error) {
	const stmt = `
SELECT id, name, email, created_at, COALESCE(locale, '')
  FROM users
 WHERE email = $1 AND status <> 'deleted'`

	row := m.DB.QueryRow(ctx, stmt, email)

	u := &User{}
	err := row.Scan(
		&u.ID,
		&u.Name,
		&u.Email,
		&u.CreatedAt,
		&u.Locale,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoRecord
		}
		return nil, err
	}
	return u, nil
}

func (m *UserModel) PasswordUpdate(ctx context.Context, id int, currentPassword, newPassword string) error {
	var currentHashedPassword []byte
	stmt := `SELECT hashed_password 
	FROM users 
	WHERE id = $1`
	err := m.DB.QueryRow(ctx, stmt, id).Scan(&currentHashedPassword)
	if err != nil {
		return err
	}

	err = bcrypt.CompareHashAndPassword(currentHashedPassword, []byte(currentPassword))
	if err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return ErrInvalidCredentials
		} else {
			return err
		}
	}

	newHashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return err
	}

	stmt = `
	UPDATE users 
	SET hashed_password = $1 
	WHERE id = $2`
	_, err = m.DB.Exec(ctx, stmt, string(newHashedPassword), id)
	return err
}

// PasswordReset sets the password of the user of the token and uses the token up. As
// Authenticate, it tells an account that may not sign in by the error, with the id:
// ErrUserNotActivated for one not confirmed, ErrDeletionScheduled for one in its grace period.
// The password is changed in both cases.
func (m *UserModel) PasswordReset(ctx context.Context, tokenPlaintext string, newPassword string) (int, error) {
	tokenHash := sha256.Sum256([]byte(tokenPlaintext))

	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	consumeToken := `
        DELETE FROM tokens
        WHERE hash = $1 AND scope = $2 AND expiry > $3
        RETURNING user_id
    `

	var userID int
	err = tx.QueryRow(ctx, consumeToken, tokenHash[:], ScopeChangePassword, time.Now()).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNoRecord
		}
		return 0, err
	}

	newHashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return 0, err
	}

	var status userStatus
	err = tx.QueryRow(ctx, `
	UPDATE users
	SET hashed_password = $1
	WHERE id = $2
	RETURNING status`, string(newHashedPassword), userID).Scan(&status)
	if err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	switch status {
	case statusEmailVerified:
		return userID, nil
	case statusDeleting:
		return userID, ErrDeletionScheduled
	default:
		return userID, ErrUserNotActivated
	}
}

func (m *UserModel) ActivateForToken(ctx context.Context, tokenScope TokenScope, tokenPlaintext string) (int, error) {
	tokenHash := sha256.Sum256([]byte(tokenPlaintext))

	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	// 1) consume the token and get the associated user_id
	consumeToken := `
        DELETE FROM tokens
        WHERE hash = $1 AND scope = $2 AND expiry > $3
        RETURNING user_id
    `

	var userID int
	err = tx.QueryRow(ctx, consumeToken, tokenHash[:], tokenScope, time.Now()).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNoRecord
		}
		return 0, err
	}

	// 2) activate the user
	activateUser := `
        UPDATE users
        SET status = 'email_verified'
        WHERE id = $1
    `
	if _, err := tx.Exec(ctx, activateUser, userID); err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}

	return userID, nil
}

// DeletePending deletes the accounts whose email was not confirmed for olderThan. Such an account
// owns only its empty default collection and its tokens, which go by the cascades of a real DELETE.
func (m *UserModel) DeletePending(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := m.DB.Exec(ctx, `
DELETE FROM users
 WHERE status = 'pending' AND created_at < now() - make_interval(secs => $1)`, olderThan.Seconds())
	return tag.RowsAffected(), err
}
