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
}

type userStatus string

const (
	statusPending       userStatus = "pending"
	statusEmailVerified userStatus = "email_verified"
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

// Verify whether a user exists with the provided email address and password.
// Returns the relevant user ID if they do.
func (m *UserModel) Authenticate(ctx context.Context, email, password string) (int, error) {
	// Retrieve the id and hashed password associated with the given email. If
	// no matching email exists we return the ErrInvalidCredentials error.
	const stmt = `
SELECT id, hashed_password, status
  FROM users
 WHERE email = $1`

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

	if status != statusEmailVerified {
		return id, ErrUserNotActivated
	}

	// Check whether the hashed password and plain-text password provided match.
	// If they don't, return the ErrInvalidCredentials error.
	err = bcrypt.CompareHashAndPassword(hashedPassword, []byte(password))
	if err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return 0, ErrInvalidCredentials
		} else {
			return 0, err
		}
	}
	// Otherwise, the password is correct. Return the user ID.
	return id, nil
}

// Check if a user with a specific ID exists.
func (m *UserModel) Exists(ctx context.Context, id int) (bool, error) {
	const stmt = `
SELECT EXISTS(
    SELECT 1
      FROM users
     WHERE id = $1
)`
	var exists bool
	err := m.DB.QueryRow(ctx, stmt, id).Scan(&exists)
	return exists, err
}

// GetLocale returns the language the user picked, "" if none, or ErrNoRecord: the web app
// checks the session's user with it on every request instead of Exists.
func (m *UserModel) GetLocale(ctx context.Context, id int) (string, error) {
	var locale *string
	err := m.DB.QueryRow(ctx, `SELECT locale FROM users WHERE id = $1`, id).Scan(&locale)
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
 WHERE id = $1`

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
 WHERE email = $1`

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

	stmt := `
	UPDATE users 
	SET hashed_password = $1 
	WHERE id = $2`

	_, err = tx.Exec(ctx, stmt, string(newHashedPassword), userID)

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}

	return userID, err
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
