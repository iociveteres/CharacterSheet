package mocks

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"

	"charactersheet.iociveteres.net/internal/models"
)

// AvatarModel keeps avatars in memory: ByUser is the hash of each user's; a lock in Locked holds whatever
// its Until (models.AvatarModel compares it with the clock).
type AvatarModel struct {
	mu     sync.Mutex
	ByUser map[int]string
	images map[string]*models.Avatar
	Locked map[int]*models.AvatarLock
}

func (m *AvatarModel) init() {
	if m.ByUser == nil {
		m.ByUser = map[int]string{}
	}
	if m.images == nil {
		m.images = map[string]*models.Avatar{}
	}
	if m.Locked == nil {
		m.Locked = map[int]*models.AvatarLock{}
	}
}

// Of is the user's avatar, nil without one.
func (m *AvatarModel) Of(userID int) *models.Avatar {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	return m.images[m.ByUser[userID]]
}

func (m *AvatarModel) Get(ctx context.Context, hash string) (*models.Avatar, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	for _, h := range m.ByUser {
		if h == hash {
			return m.images[hash], nil
		}
	}
	return nil, models.ErrNoRecord
}

func (m *AvatarModel) Hashes(ctx context.Context, userIDs []int) (map[int]string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	hashes := map[int]string{}
	for _, id := range userIDs {
		if h, ok := m.ByUser[id]; ok {
			hashes[id] = h
		}
	}
	return hashes, nil
}

func (m *AvatarModel) Put(ctx context.Context, userID int, mime string, data []byte) (string, error) {
	if (mime != "image/webp" && mime != "image/jpeg") || len(data) == 0 || len(data) > models.AvatarMaxBytes {
		return "", models.ErrInvalidAvatar
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	if m.Locked[userID] != nil {
		return "", models.ErrAvatarLocked
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])[:16]
	m.images[hash] = &models.Avatar{Mime: mime, Data: data}
	m.ByUser[userID] = hash
	return hash, nil
}

func (m *AvatarModel) Delete(ctx context.Context, userID int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	delete(m.ByUser, userID)
	return nil
}

func (m *AvatarModel) Remove(ctx context.Context, userID int, lock *models.AvatarLock) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	delete(m.ByUser, userID)
	if lock != nil {
		l := *lock
		l.UserID = userID
		m.Locked[userID] = &l
	}
	return nil
}

func (m *AvatarModel) Unlock(ctx context.Context, userID int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	delete(m.Locked, userID)
	return nil
}

func (m *AvatarModel) LockOf(ctx context.Context, userID int) (*models.AvatarLock, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	return m.Locked[userID], nil
}

func (m *AvatarModel) Locks(ctx context.Context) ([]models.AvatarLock, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	var locks []models.AvatarLock
	for _, l := range m.Locked {
		locks = append(locks, *l)
	}
	return locks, nil
}
