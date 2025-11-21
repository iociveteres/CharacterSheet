package models

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"time"

	"charactersheet.iociveteres.net/internal/validator"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TokenScope string

const (
	ScopeVerification   TokenScope = "verification"
	ScopeChangePassword TokenScope = "change_password"
)

type Token struct {
	Plaintext string
	Hash      []byte
	UserID    int
	Expiry    time.Time
	Scope     TokenScope
}

func generateToken(userID int, ttl time.Duration, scope TokenScope) (*Token, error) {
	token := &Token{
		UserID: userID,
		Expiry: time.Now().Add(ttl),
		Scope:  scope,
	}

	randomBytes := make([]byte, 16)
	_, err := rand.Read(randomBytes)
	if err != nil {
		return nil, err
	}
	token.Plaintext = base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(randomBytes)

	hash := sha256.Sum256([]byte(token.Plaintext))
	token.Hash = hash[:]
	return token, nil
}

func ValidateTokenPlaintext(v *validator.Validator, tokenPlaintext string) {
	v.Check(tokenPlaintext != "", "token", "must be provided")
	v.Check(len(tokenPlaintext) == 26, "token", "must be 26 bytes long")
}

type TokenModelInterface interface {
	New(userID int, ttl time.Duration, scope TokenScope) (*Token, error)
	Insert(token *Token) error
	DeleteAllForUser(scope TokenScope, userID int) error
	CheckExists(scope TokenScope, token string) (bool, error)
}

type TokenModel struct {
	DB *pgxpool.Pool
}

func (m *TokenModel) New(userID int, ttl time.Duration, scope TokenScope) (*Token, error) {
	token, err := generateToken(userID, ttl, scope)
	if err != nil {
		return nil, err
	}
	err = m.Insert(token)
	return token, err
}

func (m *TokenModel) Insert(token *Token) error {
	query := `
INSERT INTO tokens (hash, user_id, expiry, scope)
VALUES ($1, $2, $3, $4)`
	args := []any{token.Hash, token.UserID, token.Expiry, token.Scope}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := m.DB.Exec(ctx, query, args...)
	return err
}

func (m *TokenModel) DeleteAllForUser(scope TokenScope, userID int) error {
	query := `
DELETE FROM tokens
WHERE scope = $1 AND user_id = $2`
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, err := m.DB.Exec(ctx, query, scope, userID)
	return err
}

func (m *TokenModel) CheckExists(scope TokenScope, tokenPlaintext string) (bool, error) {
	tokenHash := sha256.Sum256([]byte(tokenPlaintext))

	query := `
SELECT EXISTS(
	SELECT 1 FROM tokens
	WHERE scope = $1 AND hash = $2 AND expiry > $3
)`
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var exists bool
	err := m.DB.QueryRow(ctx, query, scope, tokenHash[:], time.Now()).Scan(&exists)

	return exists, err
}
