package models

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID             int
	Name           string
	Email          string
	HashedPassword []byte
	Created        time.Time
}

type UserModel struct {
	DB *pgxpool.Pool
}

func (m *UserModel) Insert(ctx context.Context, name, email, password string) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}

	const stmt = `
INSERT INTO users (name, email, hashed_password, created)
VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`
	// pgxpool.Exec returns a pgconn.CommandTag and/or error.
	_, err = m.DB.Exec(ctx, stmt, name, email, string(hashedPassword))
	if err != nil {
		// 3) Check for a Postgres unique-violation on the email column.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if pgErr.Code == pgerrcode.UniqueViolation && pgErr.ConstraintName == "users_email_key" {
				return ErrDuplicateEmail
			}
		}
		return err
	}

	return nil
}

// Verify whether a user exists with the provided email address and password.
// Returns the relevant user ID if they do.
func (m *UserModel) Authenticate(ctx context.Context, email, password string) (int, error) {
	// Retrieve the id and hashed password associated with the given email. If
	// no matching email exists we return the ErrInvalidCredentials error.
	const stmt = `
SELECT id, hashed_password
  FROM users
 WHERE email = $1`

	var id int
	var hashedPassword []byte

	err := m.DB.QueryRow(ctx, stmt, email).Scan(&id, &hashedPassword)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrInvalidCredentials
		} else {
			return 0, err
		}
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
