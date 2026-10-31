package mocks

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"

	"charactersheet.iociveteres.net/internal/models"
)

// PortraitModel keeps portraits in memory, with the rights of the sheets of
// CharacterSheetModel: user 1 edits sheets 1 and 3 and only views sheet 4,
// another user sees none of them, any other sheet does not exist.
type PortraitModel struct {
	mu     sync.Mutex
	images map[string]*models.Portrait
	// Links is the hash of each sheet's portrait.
	Links map[int]string
}

func portraitRights(userID, sheetID int) (view, edit bool, err error) {
	switch sheetID {
	case 1, 3:
		return userID == 1, userID == 1, nil
	case 4:
		return userID == 1, false, nil
	}
	return false, false, models.ErrNoRecord
}

func (m *PortraitModel) Get(ctx context.Context, userID int, hash string) (*models.Portrait, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for sheetID, h := range m.Links {
		if view, _, _ := portraitRights(userID, sheetID); view && h == hash {
			return m.images[hash], nil
		}
	}
	return nil, models.ErrNoRecord
}

func (m *PortraitModel) Put(ctx context.Context, userID, sheetID int, mime string, data []byte) (string, error) {
	_, edit, err := portraitRights(userID, sheetID)
	if err != nil {
		return "", err
	}
	if !edit {
		return "", models.ErrPermissionDenied
	}
	if (mime != "image/webp" && mime != "image/jpeg") || len(data) == 0 || len(data) > models.PortraitMaxBytes {
		return "", models.ErrInvalidPortrait
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])[:16]

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.images == nil {
		m.images, m.Links = map[string]*models.Portrait{}, map[int]string{}
	}
	m.images[hash] = &models.Portrait{Mime: mime, Data: data}
	m.Links[sheetID] = hash
	return hash, nil
}

func (m *PortraitModel) Delete(ctx context.Context, userID, sheetID int) error {
	_, edit, err := portraitRights(userID, sheetID)
	if err != nil {
		return err
	}
	if !edit {
		return models.ErrPermissionDenied
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.Links, sheetID)
	return nil
}
