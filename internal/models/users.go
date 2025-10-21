package models

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"time"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"golang.org/x/crypto/bcrypt"
)

type UserModelInterface interface {
	Insert(ctx context.Context, name, email, password string) (int, error)
	Authenticate(ctx context.Context, email, password string) (int, error)
	Exists(ctx context.Context, id int) (bool, error)
	Get(ctx context.Context, id int) (*User, error)
	PasswordUpdate(ctx context.Context, id int, currentPassword, newPassword string) error
	ActivateForToken(ctx context.Context, tokenScope TokenScope, tokenPlaintext string) error
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
}

type UserModel struct {
	DB *pgxpool.Pool
}

func (m *UserModel) Insert(ctx context.Context, name, email, password string) (int, error) {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return 0, err
	}

	const stmt = `
INSERT INTO users (name, email, hashed_password, created_at)
VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
RETURNING id`

	var id int
	err = m.DB.QueryRow(ctx, stmt, name, email, string(hashedPassword)).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if pgErr.Code == pgerrcode.UniqueViolation && pgErr.ConstraintName == "users_email_key" {
				return 0, ErrDuplicateEmail
			}
		}
		return 0, err
	}

	return id, nil
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

func (m *UserModel) Get(ctx context.Context, id int) (*User, error) {
	const stmt = `
SELECT id, name, email, created_at
  FROM users
 WHERE id = $1`

	row := m.DB.QueryRow(ctx, stmt, id)

	u := &User{}
	err := row.Scan(
		&u.ID,
		&u.Name,
		&u.Email,
		&u.CreatedAt,
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

func (m *UserModel) ActivateForToken(ctx context.Context, tokenScope TokenScope, tokenPlaintext string) error {
	tokenHash := sha256.Sum256([]byte(tokenPlaintext))

	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return err
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
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNoRecord
		}
		return err
	}

	// 2) activate the user
	activateUser := `
        UPDATE users
        SET status = 'email_verified'
        WHERE id = $1
    `
	if _, err := tx.Exec(ctx, activateUser, userID); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	return nil
}
