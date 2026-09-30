package mocks

import (
	"context"
	"encoding/json"
	"time"

	"charactersheet.iociveteres.net/internal/models"
)

var mockCharacterSheet = &models.CharacterSheet{
	ID:            1,
	OwnerID:       1,
	RoomID:        1,
	CharacterName: "Test Character",
	Content:       json.RawMessage(`{"characterInfo":{"characterName":"Test Character"}}`),
	Visibility:    models.VisibilityEveryoneCanView,
	Kind:          models.KindBlackCrusade,
	CreatedAt:     time.Now(),
	UpdatedAt:     time.Now(),
}

// Sheet 3 lives in room 2, but user 1 may view it.
var mockSheetOfOtherRoom = &models.CharacterSheet{
	ID:            3,
	OwnerID:       1,
	RoomID:        2,
	CharacterName: "Other Room Character",
	Content:       json.RawMessage(`{"characterInfo":{"characterName":"Other Room Character"}}`),
	Visibility:    models.VisibilityEveryoneCanView,
	Kind:          models.KindBlackCrusade,
	CreatedAt:     time.Now(),
	UpdatedAt:     time.Now(),
}

type CharacterSheetModel struct{}

func (m *CharacterSheetModel) GetWithPermission(ctx context.Context, userID, sheetID int) (*models.CharacterSheetView, error) {
	switch sheetID {
	case 1:
		return &models.CharacterSheetView{CharacterSheet: mockCharacterSheet, CanView: true, CanEdit: true}, nil
	case 3:
		return &models.CharacterSheetView{CharacterSheet: mockSheetOfOtherRoom, CanView: true, CanEdit: true}, nil
	}
	return nil, models.ErrNoRecord
}

// The rest of CharacterSheetModelInterface, stubbed — not exercised by
// current tests but required for the interface to compile.
func (m *CharacterSheetModel) Insert(ctx context.Context, userID, roomID int, kind models.SheetKind) (int, error) {
	return 1, nil
}
func (m *CharacterSheetModel) InsertWithContent(ctx context.Context, userID, roomID int, kind models.SheetKind, content json.RawMessage) (int, error) {
	return 1, nil
}
func (m *CharacterSheetModel) Delete(ctx context.Context, userID, sheetID int) (int, error) {
	return sheetID, nil
}
func (m *CharacterSheetModel) ChangeVisibility(ctx context.Context, userID, sheetID int, visibility string) (int, error) {
	return 1, nil
}
func (m *CharacterSheetModel) Get(ctx context.Context, id int) (*models.CharacterSheet, error) {
	return mockCharacterSheet, nil
}
func (m *CharacterSheetModel) ByUser(ctx context.Context, userID int) ([]*models.CharacterSheet, error) {
	return nil, nil
}
func (m *CharacterSheetModel) CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos, init json.RawMessage) (int, error) {
	return 1, nil
}
func (m *CharacterSheetModel) ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error) {
	return 1, nil
}
func (m *CharacterSheetModel) ApplyBatch(ctx context.Context, userID, sheetID int, path []string, changes []byte) (int, error) {
	return 1, nil
}
func (m *CharacterSheetModel) DeleteItem(ctx context.Context, userID, sheetID int, path []string) (int, error) {
	return 1, nil
}
func (m *CharacterSheetModel) ReplacePositions(ctx context.Context, userID, sheetID int, path []string, positions map[string]models.Position) (int, error) {
	return 1, nil
}
func (m *CharacterSheetModel) MoveItemBetweenGrids(ctx context.Context, userID, sheetID int, fromPath, toPath []string, itemID string, toPos json.RawMessage) (int, error) {
	return 1, nil
}
func (m *CharacterSheetModel) SummaryByUser(ctx context.Context, ownerID int) ([]*models.CharacterSheetSummary, error) {
	return nil, nil
}
func (m *CharacterSheetModel) Audience(ctx context.Context, sheetID int) (*models.SheetAudience, error) {
	return &models.SheetAudience{RoomID: mockCharacterSheet.RoomID, Viewers: []int{mockCharacterSheet.OwnerID}}, nil
}
