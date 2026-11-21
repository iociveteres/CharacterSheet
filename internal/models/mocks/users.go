package mocks

import (
	"context"
	"strings"
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
	// Name is what Rename gave Alice, "" before any rename; History is her former names.
	Name    string
	History []models.NameChange
	// PendingEmail is the new address of Alice's email change in progress, "" for none; Email is
	// the address it changed to, Reverted whether RevertEmail put alicesEmail back.
	PendingEmail string
	Email        string
	Reverted     bool
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

// TakenName is the name of another account: Insert and Rename refuse it.
const TakenName = "Dupe"

func (m *UserModel) Insert(ctx context.Context, name, email, password, locale string) (int, error) {
	switch {
	case email == "dupe@example.com":
		return 0, models.ErrDuplicateEmail
	case name == TakenName:
		return 0, models.ErrDuplicateName
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

func (m *UserModel) Rename(ctx context.Context, id int, name string) error {
	if id != 1 {
		return models.ErrNoRecord
	}
	if strings.EqualFold(name, TakenName) {
		return models.ErrDuplicateName
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Name = name
	return nil
}

func (m *UserModel) NameHistory(ctx context.Context, id int, limit int) ([]models.NameChange, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id != 1 {
		return nil, nil
	}
	if limit > 0 && len(m.History) > limit {
		return m.History[:limit], nil
	}
	return m.History, nil
}

const (
	// The tokens of the links of Alice's email change: to the old address, to the new one, and the
	// revert link to the old one after the change.
	EmailOldToken    = "mock-email-old-token-00000"
	EmailNewToken    = "mock-email-new-token-00000"
	EmailRevertToken = "mock-email-revert-token-00"
	// LateTakenEmail is an address free when the change is requested and taken by its last step.
	LateTakenEmail = "late@example.com"
	alicesEmail    = "alice@example.com"
)

func (m *UserModel) RequestEmailChange(ctx context.Context, id int, password, newEmail string) (*models.Token, error) {
	if id != 1 {
		return nil, models.ErrNoRecord
	}
	if password != "pa$$word" {
		return nil, models.ErrInvalidCredentials
	}
	if newEmail == "dupe@example.com" || newEmail == alicesEmail {
		return nil, models.ErrDuplicateEmail
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.PendingEmail = newEmail
	return &models.Token{Plaintext: EmailOldToken, UserID: 1, Expiry: time.Now().Add(models.EmailChangeTTL),
		Scope: models.ScopeChangeEmailOld, Email: newEmail}, nil
}

func (m *UserModel) ConfirmOldEmail(ctx context.Context, tokenPlaintext string) (*models.Token, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if tokenPlaintext != EmailOldToken || m.PendingEmail == "" {
		return nil, models.ErrNoRecord
	}
	return &models.Token{Plaintext: EmailNewToken, UserID: 1, Expiry: time.Now().Add(models.EmailChangeTTL),
		Scope: models.ScopeChangeEmailNew, Email: m.PendingEmail}, nil
}

func (m *UserModel) ConfirmNewEmail(ctx context.Context, tokenPlaintext string) (*models.EmailChanged, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if tokenPlaintext != EmailNewToken || m.PendingEmail == "" {
		return nil, models.ErrNoRecord
	}
	newEmail := m.PendingEmail
	m.PendingEmail = ""
	if newEmail == LateTakenEmail {
		return nil, models.ErrDuplicateEmail
	}
	m.Email = newEmail
	return &models.EmailChanged{UserID: 1, OldEmail: alicesEmail, NewEmail: newEmail, RevertToken: EmailRevertToken}, nil
}

func (m *UserModel) RevertEmail(ctx context.Context, tokenPlaintext string) (int, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if tokenPlaintext != EmailRevertToken || m.Reverted {
		return 0, "", models.ErrNoRecord
	}
	m.Reverted = true
	m.Email = alicesEmail
	m.PendingEmail = ""
	return 1, alicesEmail, nil
}

func (m *UserModel) PendingEmailChange(ctx context.Context, id int) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id != 1 {
		return "", nil
	}
	return m.PendingEmail, nil
}

func (m *UserModel) CancelEmailChange(ctx context.Context, id int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id == 1 {
		m.PendingEmail = ""
	}
	return nil
}
