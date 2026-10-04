package mocks

import (
	"context"
	"sync"

	"charactersheet.iociveteres.net/internal/models"
)

// EncounterModel has encounter 1 of room 1, with sheet 1 in it, whose
// gamemaster is user 1, and encounter 2 of a room user 1 is no gamemaster of.
// Room 1 shows no encounter. A file named "Too big" does not fit into the
// quota.
type EncounterModel struct {
	models.EncounterModelInterface
	mu sync.Mutex
	// Loaded is the files loaded as new encounters.
	Loaded []string
}

func gamemaster(userID, roomID int) error {
	if userID != 1 || roomID != 1 {
		return models.ErrPermissionDenied
	}
	return nil
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
	if err := gamemaster(userID, roomID); err != nil {
		return nil, err
	}
	return &models.EncounterList{Encounters: []models.EncounterSummary{}}, nil
}

func (m *EncounterModel) Gamemasters(ctx context.Context, roomID int) ([]int, error) {
	return []int{1}, nil
}

func (m *EncounterModel) State(ctx context.Context, encounterID int) (*models.EncounterState, error) {
	return m.Get(ctx, 1, encounterID)
}

func (m *EncounterModel) Export(ctx context.Context, userID, encounterID int) (*models.EncounterFile, error) {
	if _, err := m.Get(ctx, userID, encounterID); err != nil {
		return nil, err
	}
	return &models.EncounterFile{
		Format: models.EncounterFileFormat, Version: models.EncounterFileVersion, Name: "Mock encounter", Round: 1,
		Groups: []models.GroupInFile{}, Npcs: []models.NpcInFile{},
	}, nil
}

// withNpcs is an encounter with a participant for each NPC of the file.
func withNpcs(id int, f *models.EncounterFile) *models.EncounterState {
	s := &models.EncounterState{ID: id, RoomID: 1, Name: f.Name, Round: f.Round, Groups: []models.EncounterGroup{}, Participants: []models.EncounterParticipant{}}
	for i := range f.Npcs {
		s.Groups = append(s.Groups, models.EncounterGroup{ID: i + 1})
		s.Participants = append(s.Participants, models.EncounterParticipant{ID: i + 1, GroupID: i + 1, SheetID: 100 + i, NPC: true})
	}
	return s
}

func (m *EncounterModel) Load(ctx context.Context, userID, roomID int, f *models.EncounterFile) (*models.EncounterState, error) {
	if err := gamemaster(userID, roomID); err != nil {
		return nil, err
	}
	if f.Name == "Too big" {
		return nil, &models.QuotaError{Used: models.QuotaBytes, Adding: 1 << 20, Limit: models.QuotaBytes}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Loaded = append(m.Loaded, f.Name)
	s := withNpcs(10+len(m.Loaded), f)
	// A character of the room's party, which every encounter has.
	s.Participants = append(s.Participants, models.EncounterParticipant{ID: 99, GroupID: 99, SheetID: 99, Side: models.SideParty})
	return s, nil
}

func (m *EncounterModel) ReplaceNpcs(ctx context.Context, ref models.EncounterRef, f *models.EncounterFile) (*models.EncounterState, error) {
	if ref.EncounterID != 1 {
		return nil, models.ErrPermissionDenied
	}
	if err := gamemaster(ref.UserID, ref.RoomID); err != nil {
		return nil, err
	}
	s := withNpcs(1, f)
	s.Name = "Mock encounter"
	return s, nil
}

func (m *EncounterModel) ShownView(ctx context.Context, roomID int) (*models.InitiativeView, error) {
	return nil, nil
}
