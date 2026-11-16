package mocks

import (
	"context"
	"sync"
	"time"

	"charactersheet.iociveteres.net/internal/models"
)

// UserModel knows user 1 (Alice); Locale is what SetLocale saved for her.
type UserModel struct {
	mu     sync.Mutex
	Locale string
}

func (m *UserModel) Insert(ctx context.Context, name, email, password string) (int, error) {
	switch email {
	case "dupe@example.com":
		return 0, models.ErrDuplicateEmail
	default:
		return 1, nil
	}
}
func (m *UserModel) Authenticate(ctx context.Context, email, password string) (int, error) {
	if email == "alice@example.com" && password == "pa$$word" {
		return 1, nil
	}
	return 0, models.ErrInvalidCredentials
}
func (m *UserModel) Exists(ctx context.Context, id int) (bool, error) {
	switch id {
	case 1:
		return true, nil
	default:
		return false, nil
	}
}

func (m *UserModel) GetLocale(ctx context.Context, id int) (string, error) {
	if id != 1 {
		return "", models.ErrNoRecord
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Locale, nil
}

func (m *UserModel) SetLocale(ctx context.Context, id int, locale string) error {
	if id != 1 {
		return models.ErrNoRecord
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Locale = locale
	return nil
}

func (m *UserModel) Get(ctx context.Context, id int) (*models.User, error) {
	if id == 1 {
		u := &models.User{
			ID:        1,
			Name:      "Alice",
			Email:     "alice@example.com",
			CreatedAt: time.Now(),
		}
		return u, nil
	}
	return nil, models.ErrNoRecord
}

func (m *UserModel) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	if email == "alice@example.com" {
		u := &models.User{
			ID:        1,
			Name:      "Alice",
			Email:     "alice@example.com",
			CreatedAt: time.Now(),
		}
		return u, nil
	}
	return nil, models.ErrNoRecord
}

func (m *UserModel) PasswordUpdate(ctx context.Context, id int, currentPassword, newPassword string) error {
	if id == 1 {
		if currentPassword != "pa$$word" {
			return models.ErrInvalidCredentials
		}
		return nil
	}
	return models.ErrNoRecord
}

func (m *UserModel) ActivateForToken(ctx context.Context, tokenScope models.TokenScope, tokenPlaintext string) (int, error) {
	return 0, nil
}

func (m *UserModel) PasswordReset(ctx context.Context, tokenPlaintext string, newPassword string) (int, error) {
	if tokenPlaintext == "abcdefghabcdefgh" {
		return 1, nil
	}
	return 0, models.ErrNoRecord
}
