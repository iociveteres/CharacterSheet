package roomws

import (
	"context"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

// fakeEncounters is encounter 7 of room 1, shown to the players, with NPC
// sheets 40 and 41; gmID is its gamemaster. The SQL is tested in
// internal/models.
type fakeEncounters struct {
	models.EncounterModelInterface
	mu    sync.Mutex
	state models.EncounterState
}

func newFakeEncounters() *fakeEncounters {
	return &fakeEncounters{state: models.EncounterState{ID: 7, RoomID: 1, Name: "Ambush", Round: 1, Shown: true}}
}

func (f *fakeEncounters) Gamemasters(ctx context.Context, roomID int) ([]int, error) {
	return []int{gmID}, nil
}

func (f *fakeEncounters) change(ref models.EncounterRef, change func(s *models.EncounterState)) (*models.EncounterState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if ref.UserID != gmID || ref.RoomID != 1 || ref.EncounterID != 7 {
		return nil, models.ErrPermissionDenied
	}
	change(&f.state)
	s := f.state
	return &s, nil
}

func (f *fakeEncounters) Next(ctx context.Context, ref models.EncounterRef) (*models.EncounterState, error) {
	return f.change(ref, func(s *models.EncounterState) { s.Round++ })
}

func (f *fakeEncounters) Order(ctx context.Context, ref models.EncounterRef, positions map[int]int, view *models.InitiativeView) (*models.EncounterState, error) {
	return f.change(ref, func(s *models.EncounterState) { s.InitiativeView = view })
}

func (f *fakeEncounters) CheckNpcs(ctx context.Context, ref models.EncounterRef, sheetIDs []int) error {
	if _, err := f.change(ref, func(*models.EncounterState) {}); err != nil {
		return err
	}
	for _, id := range sheetIDs {
		if id != 40 && id != 41 {
			return models.ErrInvalidEncounterRequest
		}
	}
	return nil
}

func (f *fakeEncounters) State(ctx context.Context, encounterID int) (*models.EncounterState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := f.state
	return &s, nil
}

// leavingSheets are the sheets of audienceSheets; a deleted one was in encounter 7.
type leavingSheets struct {
	*audienceSheets
}

func (s leavingSheets) Delete(ctx context.Context, userID, sheetID int) ([]int, error) {
	return []int{7}, nil
}

// echoMessages stores nothing and gives the message back as stored.
type echoMessages struct {
	mocks.RoomMessagesModel
}

func (*echoMessages) CreateWithUsername(ctx context.Context, userID, roomID int, messageBody string, commandResult, characterName *string) (models.MessageWithName, error) {
	return models.MessageWithName{
		Message:  models.Message{ID: 1, RoomID: roomID, UserID: userID, MessageBody: messageBody, CommandResult: commandResult, CharacterName: characterName},
		Username: "gm",
	}, nil
}

func newEncounterRoom(t *testing.T) (func(userID int) *peer, func()) {
	t.Helper()
	sheets := leavingSheets{&audienceSheets{
		room:       map[int]int{10: 1, 30: 1},
		visibility: map[int]models.SheetVisibility{10: models.VisibilityEveryoneCanView, 30: models.VisibilityEveryoneCanView},
	}}
	server, dial := serveRoom(t, models.Models{
		CharacterSheets: sheets,
		Encounters:      newFakeEncounters(),
		RoomMessages:    &echoMessages{},
	})
	// A marker after everything queued: whoever gets it first got nothing before it.
	mark := func() {
		server.GetOrInitHub(1).BroadcastToUsers(nil, []int{gmID, moderatorID, ownerID, playerID}, []byte(`{"type":"marker"}`))
	}
	return dial, mark
}

func TestEncounterGoesToGamemasterOnly(t *testing.T) {
	dial, mark := newEncounterRoom(t)
	gm, gmOtherTab, moderator, player := dial(gmID), dial(gmID), dial(moderatorID), dial(playerID)

	gm.send(`{"type":"encounterNext","eventID":"e1","encounterId":7}`)
	if msg := gm.expect("encounterState", "e1"); msg["encounter"].(map[string]any)["round"] != float64(2) {
		t.Fatalf("got %v, want round 2", msg)
	}
	gmOtherTab.expect("encounterState", "e1")
	mark()
	moderator.expect("marker", "")
	player.expect("marker", "")
}

func TestEncounterRefusedToOthers(t *testing.T) {
	dial, mark := newEncounterRoom(t)
	gm, moderator := dial(gmID), dial(moderatorID)

	moderator.send(`{"type":"encounterNext","eventID":"e1","encounterId":7}`)
	if resp := moderator.expect("response", "e1"); resp["OK"] != false || resp["code"] != "permission" {
		t.Fatalf("got %v, want a permission error", resp)
	}
	mark()
	gm.expect("marker", "")
}

func TestShownOrderReachesPlayers(t *testing.T) {
	dial, _ := newEncounterRoom(t)
	gm, player := dial(gmID), dial(playerID)

	gm.send(`{"type":"encounterOrder","eventID":"e1","encounterId":7,"positions":{"1":0},` +
		`"view":{"round":1,"current":0,"rows":[{"name":"Figure","value":12,"wounds":7,"sheetId":40}]}}`)
	msg := player.expect("initiativeView", "")
	rows := msg["view"].(map[string]any)["rows"].([]any)
	if row := rows[0].(map[string]any); len(rows) != 1 || row["name"] != "Figure" || row["value"] != float64(12) || len(row) != 2 {
		t.Fatalf("got %v, want the row with its name and value only", rows)
	}
	gm.expect("initiativeView", "")
	gm.expect("encounterState", "e1")

	gm.send(`{"type":"encounterOrder","eventID":"e2","encounterId":7,"positions":{},"view":{"round":0,"rows":[]}}`)
	if resp := gm.expect("response", "e2"); resp["code"] != "validation" {
		t.Fatalf("got %v, want a validation error", resp)
	}
}

func TestRollInitiativeForNpcs(t *testing.T) {
	dial, mark := newEncounterRoom(t)
	gm, player := dial(gmID), dial(playerID)

	gm.send(`{"type":"encounterRollInitiative","eventID":"e1","encounterId":7,"rolls":[` +
		`{"sheetId":40,"name":"Figure in the shadows","expression":"1d10+3"},{"sheetId":41,"name":"Orcs","expression":"1d10 + 1"}]}`)
	msg := player.expect("chatMessage", "e1")
	lines := strings.Split(msg["commandResult"].(string), "\n")
	want := regexp.MustCompile(`^(Figure in the shadows: 1d10\+3|Orcs: 1d10\+1) = \d+$`)
	if msg["messageBody"] != "Initiative" || len(lines) != 2 || !want.MatchString(lines[0]) || !want.MatchString(lines[1]) {
		t.Fatalf("got %v", msg)
	}
	if _, signed := msg["characterName"]; signed {
		t.Errorf("signed with a character: %v", msg)
	}
	gm.expect("chatMessage", "e1")
	totals := gm.expect("encounterRolled", "e1")["totals"].([]any)
	var sheets []float64
	for _, total := range totals {
		sheets = append(sheets, total.(map[string]any)["sheetId"].(float64))
	}
	if !slices.Equal(sheets, []float64{40, 41}) {
		t.Errorf("totals %v", totals)
	}

	// A character rolls for itself.
	gm.send(`{"type":"encounterRollInitiative","eventID":"e2","encounterId":7,"rolls":[{"sheetId":10,"name":"Ulrich","expression":"1d10"}]}`)
	if resp := gm.expect("response", "e2"); resp["code"] != "validation" {
		t.Fatalf("got %v, want a validation error", resp)
	}
	gm.send(`{"type":"encounterRollInitiative","eventID":"e3","encounterId":7,"rolls":[{"sheetId":40,"name":"Figure","expression":"d100 vs 50"}]}`)
	if resp := gm.expect("response", "e3"); resp["code"] != "validation" {
		t.Fatalf("got %v, want a validation error", resp)
	}
	mark()
	player.expect("marker", "")
}

func TestDeletedSheetLeavesEncounter(t *testing.T) {
	dial, _ := newEncounterRoom(t)
	gm, owner := dial(gmID), dial(ownerID)

	owner.send(`{"type":"deleteCharacter","eventID":"e1","sheetID":"30"}`)
	gm.expect("deleteCharacter", "e1")
	gm.expect("encounterState", "")
}
