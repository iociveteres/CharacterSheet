package mocks

import (
	"context"
	"sync"

	"charactersheet.iociveteres.net/internal/models"
)

// BestiaryModel has collection 1 of user 1, with creature 1 in it, the
// default collection 7 of user 1, public collection 2 of another user and
// private collection 4 of another user. Two uploaded or new creatures fill
// the quota.
type BestiaryModel struct {
	models.BestiaryModelInterface
	mu       sync.Mutex
	uploaded int
	// Subscribed is the collections Subscribe was called with.
	Subscribed []int
}

func own(userID, collectionID int) error {
	switch {
	case collectionID == 2:
		return models.ErrPermissionDenied
	case collectionID != 1 && collectionID != 7:
		return models.ErrNoRecord
	case userID != 1:
		return models.ErrPermissionDenied
	}
	return nil
}

func (m *BestiaryModel) Collection(ctx context.Context, userID, collectionID int) (*models.BestiaryCollection, error) {
	switch collectionID {
	case 1:
		if userID == 1 {
			return &models.BestiaryCollection{ID: 1, Name: "Orks", Own: true, Visibility: models.VisibilityPrivate, Creatures: 1}, nil
		}
	case 7:
		if userID == 1 {
			return &models.BestiaryCollection{ID: 7, Name: "My creatures", Own: true, Default: true, Visibility: models.VisibilityPrivate}, nil
		}
	case 2:
		return &models.BestiaryCollection{ID: 2, Name: "Horde", Owner: "bob", Visibility: models.VisibilityPublic}, nil
	}
	return nil, models.ErrNoRecord
}

func (m *BestiaryModel) Subscribe(ctx context.Context, userID, collectionID int) (*models.BestiaryCollection, error) {
	c, err := m.Collection(ctx, userID, collectionID)
	if err != nil {
		return nil, err
	}
	if c.Own {
		return nil, models.ErrInvalidBestiaryRequest
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Subscribed = append(m.Subscribed, collectionID)
	c.Subscribed = true
	return c, nil
}

func (m *BestiaryModel) Unsubscribe(ctx context.Context, userID, collectionID int) error {
	return nil
}

func (m *BestiaryModel) Catalog(ctx context.Context, userID int, filter models.CatalogFilter) (*models.CatalogPage, error) {
	return &models.CatalogPage{Rows: []models.CatalogRow{{ID: 2, Name: "Horde", Owner: "bob"}}}, nil
}

func (m *BestiaryModel) Creatures(ctx context.Context, userID int, filter models.CreatureFilter) ([]models.Creature, error) {
	if filter.CollectionID != nil && *filter.CollectionID != 1 && *filter.CollectionID != 2 {
		return nil, models.ErrNoRecord
	}
	return []models.Creature{}, nil
}

func (m *BestiaryModel) Get(ctx context.Context, userID int) (*models.Bestiary, error) {
	return &models.Bestiary{
		Collections: []models.BestiaryCollection{{ID: 1, Name: "Orks", Creatures: 1}},
		Quota:       models.Quota{Limit: models.QuotaBytes},
	}, nil
}

func (m *BestiaryModel) UpdateCollection(ctx context.Context, userID, collectionID int, edit models.CollectionEdit) (*models.BestiaryCollection, error) {
	if edit.Visibility != nil && !edit.Visibility.IsValid() {
		return nil, models.ErrInvalidBestiaryRequest
	}
	if err := own(userID, collectionID); err != nil {
		return nil, err
	}
	if collectionID == 7 && edit.Visibility != nil && *edit.Visibility == models.VisibilityPublic {
		return nil, models.ErrInvalidBestiaryRequest
	}
	c := &models.BestiaryCollection{ID: 1, Name: "Orks"}
	if edit.Name != nil {
		c.Name = *edit.Name
	}
	return c, nil
}

func (m *BestiaryModel) Export(ctx context.Context, userID, collectionID int) (*models.CollectionFile, error) {
	if err := own(userID, collectionID); err != nil {
		return nil, err
	}
	return &models.CollectionFile{Format: models.CollectionFileFormat, Version: models.CollectionFileVersion, Name: "Orks", Creatures: []models.CreatureInFile{}}, nil
}

func (m *BestiaryModel) Upload(ctx context.Context, userID, collectionID int, creatures []models.CreatureInFile) (int, error) {
	if err := own(userID, collectionID); err != nil {
		return 0, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.uploaded+len(creatures) > 2 {
		return 0, &models.QuotaError{Used: models.QuotaBytes, Adding: 1 << 20, Limit: models.QuotaBytes}
	}
	m.uploaded += len(creatures)
	return len(creatures), nil
}

func (m *BestiaryModel) NewCreature(ctx context.Context, userID, collectionID int, kind models.SheetKind) (*models.Creature, error) {
	if !kind.IsValid() {
		return nil, models.ErrInvalidBestiaryRequest
	}
	if err := own(userID, collectionID); err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.uploaded+1 > 2 {
		return nil, &models.QuotaError{Used: models.QuotaBytes, Adding: 1 << 10, Limit: models.QuotaBytes}
	}
	m.uploaded++
	return &models.Creature{ID: 6, CollectionID: collectionID, Name: "New creature", Kind: kind}, nil
}

func (m *BestiaryModel) MoveCreature(ctx context.Context, userID, creatureID, collectionID int) (*models.Creature, error) {
	if creatureID != 1 {
		return nil, models.ErrNoRecord
	}
	if err := own(userID, collectionID); err != nil {
		return nil, err
	}
	return &models.Creature{ID: 1, CollectionID: 1, Name: "Ork Boy", Kind: models.KindBlackCrusade}, nil
}

// CopyCreature copies creature 1 into collection 1, or into a new collection 5.
func (m *BestiaryModel) CopyCreature(ctx context.Context, userID, creatureID int, target models.CollectionTarget) (*models.Creature, error) {
	if creatureID != 1 {
		return nil, models.ErrNoRecord
	}
	collectionID := 5
	if target.NewCollection == "" {
		if err := own(userID, target.CollectionID); err != nil {
			return nil, err
		}
		collectionID = target.CollectionID
	}
	return &models.Creature{ID: 3, CollectionID: collectionID, Name: "Ork Boy", Kind: models.KindBlackCrusade}, nil
}

func (m *BestiaryModel) Save(ctx context.Context, userID, sheetID int, target models.CollectionTarget) (*models.Creature, error) {
	return nil, &models.QuotaError{Used: models.QuotaBytes, Adding: 1 << 20, Limit: models.QuotaBytes}
}

// AddVariant adds a variant of NPC 1 of encounter 1, whose creature is
// creature 1; no other NPC has one.
func (m *BestiaryModel) AddVariant(ctx context.Context, userID, sheetID int, name string) (*models.Creature, int, error) {
	if userID != 1 || sheetID != 1 {
		return nil, 0, models.ErrInvalidBestiaryRequest
	}
	return &models.Creature{ID: 5, CollectionID: 1, Name: name, Kind: models.KindBlackCrusade}, 1, nil
}

func (m *BestiaryModel) DeleteCreature(ctx context.Context, userID, creatureID int) error {
	if creatureID != 1 {
		return models.ErrNoRecord
	}
	return own(userID, 1)
}

// DeleteCollection deletes collection 1 with creature 1 in it.
func (m *BestiaryModel) DeleteCollection(ctx context.Context, userID, collectionID int) ([]int, error) {
	if err := own(userID, collectionID); err != nil {
		return nil, err
	}
	if collectionID == 7 {
		return nil, models.ErrInvalidBestiaryRequest
	}
	return []int{1}, nil
}
