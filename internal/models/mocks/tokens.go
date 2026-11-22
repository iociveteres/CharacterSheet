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

// OthersDeleteToken is a deletion link's token of user 2.
const OthersDeleteToken = "others-delete-token-000000"

// UserID knows the tokens of the deletion and cancel links of Alice and the deletion link of
// user 2; whether a cancel link still works is up to UserModel.CancelDeletion.
func (m *TokenModel) UserID(ctx context.Context, scope models.TokenScope, tokenPlaintext string) (int, error) {
	switch {
	case scope == models.ScopeDeleteAccount && tokenPlaintext == DeleteToken:
		return 1, nil
	case scope == models.ScopeDeleteAccount && tokenPlaintext == OthersDeleteToken:
		return 2, nil
	case scope == models.ScopeCancelDeletion && tokenPlaintext == CancelToken:
		return 1, nil
	}
	return 0, models.ErrNoRecord
}

// Email knows the tokens of the links of Alice's email change (users.go): the new address for
// the links of the change, hers for the revert link.
func (m *TokenModel) Email(ctx context.Context, scope models.TokenScope, tokenPlaintext string) (string, error) {
	switch {
	case scope == models.ScopeChangeEmailOld && tokenPlaintext == EmailOldToken,
		scope == models.ScopeChangeEmailNew && tokenPlaintext == EmailNewToken:
		return "new@example.com", nil
	case scope == models.ScopeRevertEmail && tokenPlaintext == EmailRevertToken:
		return alicesEmail, nil
	}
	return "", models.ErrNoRecord
}
