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
	New(ctx context.Context, userID int, ttl time.Duration, scope TokenScope) (*Token, error)
	Insert(ctx context.Context, token *Token) error
	DeleteAllForUser(ctx context.Context, scope TokenScope, userID int) error
	CheckExists(ctx context.Context, scope TokenScope, token string) (bool, error)
}

type TokenModel struct {
	DB *pgxpool.Pool
}

func (m *TokenModel) New(ctx context.Context, userID int, ttl time.Duration, scope TokenScope) (*Token, error) {
	token, err := generateToken(userID, ttl, scope)
	if err != nil {
		return nil, err
	}
	err = m.Insert(ctx, token)
	return token, err
}

func (m *TokenModel) Insert(ctx context.Context, token *Token) error {
	query := `
INSERT INTO tokens (hash, user_id, expiry, scope)
VALUES ($1, $2, $3, $4)`
	args := []any{token.Hash, token.UserID, token.Expiry, token.Scope}
	_, err := m.DB.Exec(ctx, query, args...)
	return err
}

func (m *TokenModel) DeleteAllForUser(ctx context.Context, scope TokenScope, userID int) error {
	query := `
DELETE FROM tokens
WHERE scope = $1 AND user_id = $2`
	_, err := m.DB.Exec(ctx, query, scope, userID)
	return err
}

func (m *TokenModel) CheckExists(ctx context.Context, scope TokenScope, tokenPlaintext string) (bool, error) {
	tokenHash := sha256.Sum256([]byte(tokenPlaintext))

	query := `
SELECT EXISTS(
	SELECT 1 FROM tokens
	WHERE scope = $1 AND hash = $2 AND expiry > $3
)`
	var exists bool
	err := m.DB.QueryRow(ctx, query, scope, tokenHash[:], time.Now()).Scan(&exists)

	return exists, err
}
