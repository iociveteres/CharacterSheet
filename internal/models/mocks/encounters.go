package mocks

import (
	"context"

	"charactersheet.iociveteres.net/internal/models"
)

// EncounterModel has encounter 1 of room 1, with sheet 1 in it, whose
// gamemaster is user 1, and encounter 2 of a room user 1 is no gamemaster of.
// Room 1 shows no encounter.
type EncounterModel struct {
	models.EncounterModelInterface
}

func (m *EncounterModel) Get(ctx context.Context, userID, encounterID int) (*models.EncounterState, error) {
	if encounterID == 2 || (encounterID == 1 && userID != 1) {
		return nil, models.ErrPermissionDenied
	}
	if encounterID != 1 {
		return nil, models.ErrNoRecord
	}
	return &models.EncounterState{
		ID: 1, RoomID: 1, Name: "Mock encounter", Round: 1,
		Groups:       []models.EncounterGroup{{ID: 1}},
		Participants: []models.EncounterParticipant{{ID: 1, GroupID: 1, SheetID: 1, Name: "Test Character"}},
	}, nil
}

func (m *EncounterModel) List(ctx context.Context, userID, roomID int) (*models.EncounterList, error) {
	return &models.EncounterList{Encounters: []models.EncounterSummary{}}, nil
}

func (m *EncounterModel) ShownView(ctx context.Context, roomID int) (*models.InitiativeView, error) {
	return nil, nil
}
