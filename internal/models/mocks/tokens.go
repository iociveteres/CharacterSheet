package mocks

import (
	"context"
	"time"

	"charactersheet.iociveteres.net/internal/models"
)

type TokenModel struct{}

func (m *TokenModel) New(ctx context.Context, userID int, ttl time.Duration, scope models.TokenScope) (*models.Token, error) {
	return &models.Token{
		Plaintext: "mock-token-plaintext-000000",
		UserID:    userID,
		Expiry:    time.Now().Add(ttl),
		Scope:     scope,
	}, nil
}

func (m *TokenModel) Insert(ctx context.Context, token *models.Token) error {
	return nil
}

func (m *TokenModel) DeleteAllForUser(ctx context.Context, scope models.TokenScope, userID int) error {
	return nil
}

func (m *TokenModel) CheckExists(ctx context.Context, scope models.TokenScope, tokenPlaintext string) (bool, error) {
	return tokenPlaintext == "abcdefghabcdefgh", nil
}
