package mocks

import (
	"context"
	"sync"
	"time"

	"charactersheet.iociveteres.net/internal/models"
)

// UserModel knows user 1 (Alice); Locale is what SetLocale saved for her, InsertedLocale
// the locale of the last Insert. Alice's deletion is scheduled by ScheduleDeletion with
// DeleteToken and cancelled by CancelDeletion; while it is pending she is in her grace period.
// Wipe carries it out: then Wiped is set and the deletion is gone.
type UserModel struct {
	mu             sync.Mutex
	Locale         string
	InsertedLocale string
	// Deletion is Alice's pending deletion, nil for none.
	Deletion   *models.DeletionChoices
	DeleteAt   time.Time
	RemindedAt *time.Time
	Wiped      bool
	// PendingOlderThan is what the last DeletePending got.
	PendingOlderThan time.Duration
	// ExportFile is the archive of Alice's data export that Wipe returns.
	ExportFile string
}

// Schedule puts Alice into her grace period with the deletion at deleteAt and the reminder at
// remindedAt, nil for none, as the database of the background job might have it.
func (m *UserModel) Schedule(deleteAt time.Time, remindedAt *time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Deletion = &models.DeletionChoices{}
	m.DeleteAt = deleteAt
	m.RemindedAt = remindedAt
}

// State is Alice's reminder, nil for none, and whether she is wiped.
func (m *UserModel) State() (remindedAt *time.Time, wiped bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.RemindedAt, m.Wiped
}

func (m *UserModel) deleting() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Deletion != nil
}

func (m *UserModel) Insert(ctx context.Context, name, email, password, locale string) (int, error) {
	switch email {
	case "dupe@example.com":
		return 0, models.ErrDuplicateEmail
	default:
		m.mu.Lock()
		defer m.mu.Unlock()
		m.InsertedLocale = locale
		return 1, nil
	}
}
func (m *UserModel) Authenticate(ctx context.Context, email, password string) (int, error) {
	if email == "alice@example.com" && password == "pa$$word" {
		if m.deleting() {
			return 1, models.ErrDeletionScheduled
		}
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

func (m *UserModel) locale() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Locale
}

func (m *UserModel) GetLocale(ctx context.Context, id int) (string, error) {
	if id != 1 || m.deleting() {
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
			Locale:    m.locale(),
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
			Locale:    m.locale(),
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
		if m.deleting() {
			return 1, models.ErrDeletionScheduled
		}
		return 1, nil
	}
	return 0, models.ErrNoRecord
}

// DeletionSummary gives Alice a room of her own with Bob (2) and Carol (3), Carol a gamemaster.
func (m *UserModel) DeletionSummary(ctx context.Context, userID int) (*models.DeletionSummary, error) {
	if userID != 1 || m.deleting() {
		return nil, models.ErrNoRecord
	}
	return &models.DeletionSummary{
		Name:                "Alice",
		LoneRooms:           []models.NamedRoom{{ID: 2, Name: "Solo"}},
		FormerMembersSheets: 1,
		OwnedRooms: []models.OwnedRoom{{
			NamedRoom:   models.NamedRoom{ID: 1, Name: "Room"},
			Members:     []models.RoomHeir{{ID: 2, Name: "Bob"}, {ID: 3, Name: "Carol"}},
			DefaultHeir: 3,
		}},
		HandedSheets:       2,
		DeletedCollections: []string{"My creatures"},
		KeptCollections:    []models.KeptCollection{{Name: "Shared", Subscribers: 4}},
		ChatMessages:       5,
		ForumPosts:         1,
		Moderator:          true,
	}, nil
}

// DeleteToken is the token of Alice's deletion link: what TokenModel.New makes.
const DeleteToken = "mock-token-plaintext-000000"

// CancelToken is the token of the cancel link ScheduleDeletion returns.
const CancelToken = "mock-cancel-token-00000000"

func (m *UserModel) ScheduleDeletion(ctx context.Context, userID int, tokenPlaintext string, choices models.DeletionChoices) (*models.ScheduledDeletion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if userID != 1 || tokenPlaintext != DeleteToken || m.Deletion != nil {
		return nil, models.ErrNoRecord
	}
	m.Deletion = &choices
	m.DeleteAt = time.Now().Add(models.DeletionGrace)
	m.RemindedAt = nil
	return &models.ScheduledDeletion{DeleteAt: m.DeleteAt, CancelToken: CancelToken}, nil
}

func (m *UserModel) PendingDeletion(ctx context.Context, userID int) (time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if userID != 1 || m.Deletion == nil {
		return time.Time{}, models.ErrNoRecord
	}
	return m.DeleteAt, nil
}

func (m *UserModel) CancelDeletion(ctx context.Context, userID int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if userID != 1 || m.Deletion == nil {
		return models.ErrNoRecord
	}
	m.Deletion = nil
	return nil
}

// Wipe gives Alice's email, name and locale, and no rooms.
func (m *UserModel) Wipe(ctx context.Context, userID int) (*models.WipedAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if userID != 1 || m.Deletion == nil {
		return nil, models.ErrNoRecord
	}
	m.Deletion = nil
	m.Wiped = true
	return &models.WipedAccount{Email: "alice@example.com", Name: "Alice", Locale: m.Locale, ExportFile: m.ExportFile}, nil
}

func (m *UserModel) DeletePending(ctx context.Context, olderThan time.Duration) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.PendingOlderThan = olderThan
	return 0, nil
}

func (m *UserModel) PendingAccounts(ctx context.Context) ([]models.PendingAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Deletion == nil {
		return nil, nil
	}
	return []models.PendingAccount{{
		UserID: 1, Email: "alice@example.com", Name: "Alice", Locale: m.Locale, DeleteAt: m.DeleteAt, RemindedAt: m.RemindedAt,
	}}, nil
}

func (m *UserModel) MarkReminded(ctx context.Context, userID int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if userID == 1 && m.Deletion != nil {
		now := time.Now()
		m.RemindedAt = &now
	}
	return nil
}

func (m *UserModel) HurryDeletion(ctx context.Context, userID int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if userID != 1 || m.Deletion == nil {
		return models.ErrNoRecord
	}
	back := time.Now().Add(-48 * time.Hour)
	m.DeleteAt = back
	m.RemindedAt = &back
	return nil
}
