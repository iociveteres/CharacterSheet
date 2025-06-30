package models

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgerrcode"
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
func (m *UserModel) Authenticate(email, password string) (int, error) {
	return 0, nil
}

// Check if a user with a specific ID exists.
func (m *UserModel) Exists(id int) (bool, error) {
	return false, nil
}
