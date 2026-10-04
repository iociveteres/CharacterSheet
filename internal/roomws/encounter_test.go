package roomws

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

// fakeEncounters is encounter 7 of room 1, shown to the players, with NPC
// sheets 40 and 41 (participant 1 is the first); gmID is its gamemaster.
// Encounter 8 of the room, not shown, gets the changes of the party only,
// unless the room has no encounters. The SQL is tested in internal/models.
type fakeEncounters struct {
	models.EncounterModelInterface
	mu           sync.Mutex
	state        models.EncounterState
	noEncounters bool
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

// PartyAdd reaches encounters 7 and 8 and has the state of 7 when the
// request named it.
func (f *fakeEncounters) PartyAdd(ctx context.Context, ref models.EncounterRef, sheetIDs []int) (*models.EncountersChange, error) {
	if ref.UserID != gmID || ref.RoomID != 1 {
		return nil, models.ErrPermissionDenied
	}
	if f.noEncounters {
		return &models.EncountersChange{}, nil
	}
	s, err := f.change(models.EncounterRef{UserID: ref.UserID, RoomID: ref.RoomID, EncounterID: 7}, func(s *models.EncounterState) {
		for _, id := range sheetIDs {
			s.Participants = append(s.Participants, models.EncounterParticipant{SheetID: id, Side: models.SideParty})
		}
		s.InitiativeView = nil
		s.Version++
	})
	if err != nil {
		return nil, err
	}
	c := &models.EncountersChange{
		Versions: []models.EncounterVersion{{ID: 7, Version: s.Version}, {ID: 8, Version: 3}},
		Shown:    true,
	}
	if ref.EncounterID == 7 {
		c.State = s
	}
	return c, nil
}

func (f *fakeEncounters) Move(ctx context.Context, ref models.EncounterRef, participantID int, side string) (*models.EncountersChange, error) {
	if participantID != 1 {
		return nil, models.ErrInvalidEncounterRequest
	}
	s, err := f.change(ref, func(*models.EncounterState) {})
	if err != nil {
		return nil, err
	}
	return &models.EncountersChange{
		State: s, Versions: []models.EncounterVersion{{ID: s.ID, Version: s.Version}}, Shown: s.Shown, ShownView: s.InitiativeView,
	}, nil
}

func (f *fakeEncounters) Describe(ctx context.Context, ref models.EncounterRef, description string) (*models.EncounterState, error) {
	if utf8.RuneCountInString(description) > 10000 {
		return nil, models.ErrInvalidEncounterRequest
	}
	return f.change(ref, func(s *models.EncounterState) { s.Description = description })
}

func (f *fakeEncounters) Next(ctx context.Context, ref models.EncounterRef) (*models.EncounterState, error) {
	return f.change(ref, func(s *models.EncounterState) { s.Round++ })
}

func (f *fakeEncounters) Prev(ctx context.Context, ref models.EncounterRef) (*models.EncounterState, error) {
	return f.change(ref, func(s *models.EncounterState) { s.Round-- })
}

func (f *fakeEncounters) Order(ctx context.Context, ref models.EncounterRef, positions map[int]int, view *models.InitiativeView) (*models.EncounterState, error) {
	return f.change(ref, func(s *models.EncounterState) { s.InitiativeView = view })
}

func (f *fakeEncounters) DropView(ctx context.Context, ref models.EncounterRef) (*models.EncounterState, error) {
	return f.change(ref, func(s *models.EncounterState) { s.InitiativeView = nil })
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

// AddCreature adds copies of creature 50 of the gamemaster; more than 5 do
// not fit into the quota.
func (f *fakeEncounters) AddCreature(ctx context.Context, ref models.EncounterRef, creatureID, count int) (*models.EncounterState, error) {
	if creatureID != 50 {
		return nil, models.ErrPermissionDenied
	}
	if count > 5 {
		return nil, &models.QuotaError{Used: models.QuotaBytes, Adding: 1 << 20, Limit: models.QuotaBytes}
	}
	s, err := f.change(ref, func(s *models.EncounterState) {
		for range count {
			n := len(s.Participants)
			s.Participants = append(s.Participants, models.EncounterParticipant{ID: n + 1, SheetID: 60 + n, NPC: true, SourceCreatureID: &creatureID})
		}
	})
	// The first one goes on as "Ork Boy 1" once others join it.
	if err == nil && len(s.Participants) == 1+count && count > 0 {
		s.Renamed = &models.SheetName{SheetID: 60, Name: "Ork Boy 1"}
	}
	return s, err
}

func (f *fakeEncounters) State(ctx context.Context, encounterID int) (*models.EncounterState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := f.state
	return &s, nil
}

func (f *fakeEncounters) Changed(ctx context.Context, roomID int, encounterIDs []int) (*models.EncountersChange, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c := &models.EncountersChange{}
	for _, id := range encounterIDs {
		c.Versions = append(c.Versions, models.EncounterVersion{ID: id, Version: f.state.Version})
		if id == f.state.ID && f.state.Shown {
			c.Shown, c.ShownView = true, f.state.InitiativeView
		}
	}
	return c, nil
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
		room:       map[int]int{10: 1, 30: 1, 60: 1},
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
	gm, owner, player := dial(gmID), dial(ownerID), dial(playerID)

	owner.send(`{"type":"deleteCharacter","eventID":"e1","sheetID":"30"}`)
	// The encounter state goes to the gamemaster through another hub channel
	// than the messages to everyone, so it may come before or after them.
	var got []string
	for range 3 {
		got = append(got, gm.next()["type"].(string))
	}
	slices.Sort(got)
	if !slices.Equal(got, []string{"deleteCharacter", "encountersChanged", "initiativeView"}) {
		t.Errorf("the gamemaster got %v", got)
	}
	// The shown encounter lost a row: the players drop its view.
	player.expect("deleteCharacter", "e1")
	if msg := player.expect("initiativeView", ""); msg["view"] != nil {
		t.Errorf("got %v, want no view", msg)
	}
}

func TestAddCreature(t *testing.T) {
	dial, mark := newEncounterRoom(t)
	gm, player := dial(gmID), dial(playerID)

	gm.send(`{"type":"encounterAddCreature","eventID":"e1","encounterId":7,"creatureId":50,"count":3}`)
	participants := gm.expect("encounterState", "e1")["encounter"].(map[string]any)["participants"].([]any)
	if len(participants) != 3 || participants[0].(map[string]any)["sourceCreatureId"] != float64(50) {
		t.Fatalf("got %v, want 3 copies of creature 50", participants)
	}
	mark()
	player.expect("marker", "")
	gm.expect("marker", "")

	gm.send(`{"type":"encounterAddCreature","eventID":"e2","encounterId":7,"creatureId":51,"count":1}`)
	if resp := gm.expect("response", "e2"); resp["code"] != "permission" {
		t.Fatalf("got %v, want a permission error", resp)
	}
	gm.send(`{"type":"encounterAddCreature","eventID":"e3","encounterId":7,"creatureId":50,"count":6}`)
	if resp := gm.expect("response", "e3"); resp["code"] != "quota" || !strings.Contains(resp["message"].(string), "NPCs and creatures take 5.0 of 5 MB") {
		t.Fatalf("got %v, want the quota error", resp)
	}
}

// The lone NPC numbered when a second one joins it is renamed in the sheets
// open on it, as by an edit of its name.
func TestAddCreatureRenamesTheLoneOne(t *testing.T) {
	dial, mark := newEncounterRoom(t)
	gm, player := dial(gmID), dial(playerID)

	gm.send(`{"type":"encounterAddCreature","eventID":"e1","encounterId":7,"creatureId":50,"count":1}`)
	gm.expect("encounterState", "e1")
	gm.send(`{"type":"encounterAddCreature","eventID":"e2","encounterId":7,"creatureId":50,"count":1}`)
	gm.expect("encounterState", "e2")
	if msg := gm.expect("change", ""); msg["sheetID"] != "60" || msg["path"] != characterNamePath || msg["change"] != "Ork Boy 1" {
		t.Fatalf("got %v, want sheet 60 named Ork Boy 1", msg)
	}
	mark()
	player.expect("marker", "")
}

// Over HTTP the gamemaster replaced the NPCs of the shown encounter: the
// players see no order until the gamemaster's client publishes the new one,
// and nothing of the encounter itself.
func TestDroppedViewReachesPlayersAsNoOrder(t *testing.T) {
	dial, _ := newEncounterRoom(t)
	gm, player := dial(gmID), dial(playerID)

	gm.send(`{"type":"encounterOrder","eventID":"e1","encounterId":7,"positions":{"1":0},` +
		`"view":{"round":1,"current":0,"rows":[{"name":"Figure","value":12,"wounds":7,"sheetId":40}]}}`)
	player.expect("initiativeView", "")
	until(gm, "initiativeView", "encounterState")

	gm.send(`{"type":"encounterDropView","eventID":"e2","encounterId":7}`)
	if view, ok := player.expect("initiativeView", "")["view"]; !ok || view != nil {
		t.Errorf("the player got view %v, want null", view)
	}
	for _, msg := range until(gm, "initiativeView", "encounterState") {
		if msg["type"] == "encounterState" && msg["encounter"].(map[string]any)["initiativeView"] != nil {
			t.Errorf("the gamemaster got %v, want no view", msg)
		}
	}
}

func TestReplacedNpcsReachPlayersAsNoOrder(t *testing.T) {
	server, dial := serveRoom(t, models.Models{Encounters: newFakeEncounters()})
	gm, player := dial(gmID), dial(playerID)

	server.EncounterNpcsReplaced(context.Background(), &models.EncounterState{ID: 7, RoomID: 1, Shown: true})
	server.GetOrInitHub(1).BroadcastToUsers(nil, []int{gmID, playerID}, []byte(`{"type":"marker"}`))

	// The view goes through another channel of the hub than the marker: either
	// may come first. The encounter goes through the marker's, before it.
	got := func(p *peer) map[string]map[string]any {
		msgs := map[string]map[string]any{}
		for msgs["marker"] == nil || msgs["initiativeView"] == nil {
			msg := p.next()
			msgs[msg["type"].(string)] = msg
		}
		return msgs
	}
	msgs := got(gm)
	if msgs["encounterState"] == nil {
		t.Errorf("the gamemaster got %v", msgs)
	}
	msgs = got(player)
	if view, ok := msgs["initiativeView"]["view"]; !ok || view != nil {
		t.Errorf("the player got view %v, want null", msgs["initiativeView"])
	}
	if msgs["encounterState"] != nil {
		t.Errorf("the player got the encounter: %v", msgs["encounterState"])
	}
}

// until reads the messages of the peer until it has one of each type of
// `types`: the view goes through another channel of the hub than the rest,
// so it may come before or after them.
func until(p *peer, types ...string) []map[string]any {
	var msgs []map[string]any
	for len(types) > 0 {
		msg := p.next()
		msgs = append(msgs, msg)
		if i := slices.Index(types, msg["type"].(string)); i >= 0 {
			types = slices.Delete(types, i, i+1)
		}
	}
	return msgs
}

func TestPartyAddReachesEveryEncounter(t *testing.T) {
	dial, mark := newEncounterRoom(t)
	gm, gmOtherTab, player := dial(gmID), dial(gmID), dial(playerID)

	player.send(`{"type":"partyAdd","eventID":"e1","encounterId":7,"sheetIds":[10]}`)
	if resp := player.expect("response", "e1"); resp["code"] != "permission" {
		t.Fatalf("got %v, want a permission error", resp)
	}

	// The state of the open encounter goes whole, the other one by its version.
	gm.send(`{"type":"partyAdd","eventID":"e2","encounterId":7,"sheetIds":[10]}`)
	for _, p := range []*peer{gm, gmOtherTab} {
		msgs := until(p, "encounterState", "encountersChanged", "initiativeView")
		for _, msg := range msgs {
			switch msg["type"] {
			case "encounterState":
				if msg["eventID"] != "e2" || msg["encounter"].(map[string]any)["id"] != 7.0 {
					t.Errorf("got %v, want the state of encounter 7", msg)
				}
			case "encountersChanged":
				if fmt.Sprint(msg["encounters"]) != "[map[id:8 version:3]]" {
					t.Errorf("got %v, want encounter 8 only", msg)
				}
			}
		}
	}

	// Without an encounter open, the sender hears back with an OK.
	gm.send(`{"type":"partyAdd","eventID":"e3","encounterId":null,"sheetIds":[11]}`)
	for _, msg := range until(gm, "response", "encountersChanged") {
		if msg["type"] == "response" && msg["OK"] != true {
			t.Errorf("got %v, want OK", msg)
		}
		if msg["type"] == "encounterState" {
			t.Errorf("got %v, want no state", msg)
		}
	}
	// The players drop the order of the shown encounter, which has a new row.
	mark()
	for _, msg := range until(player, "initiativeView", "marker") {
		if msg["type"] == "initiativeView" && msg["view"] != nil {
			t.Errorf("got %v, want no view", msg)
		}
	}
}

func TestPartyAddWithoutEncounters(t *testing.T) {
	fake := newFakeEncounters()
	fake.noEncounters = true
	_, dial := serveRoom(t, models.Models{Encounters: fake})
	gm := dial(gmID)

	gm.send(`{"type":"partyAdd","eventID":"e1","sheetIds":[10]}`)
	if resp := gm.expect("response", "e1"); resp["OK"] != true {
		t.Fatalf("got %v, want OK", resp)
	}
}

func TestMoveAndDescribe(t *testing.T) {
	dial, mark := newEncounterRoom(t)
	gm, gmOtherTab, player := dial(gmID), dial(gmID), dial(playerID)

	// Participant 2 is not of encounter 7.
	gm.send(`{"type":"encounterMove","eventID":"e1","encounterId":7,"participantId":2,"side":"party"}`)
	if resp := gm.expect("response", "e1"); resp["code"] != "validation" {
		t.Fatalf("got %v, want a validation error", resp)
	}
	gm.send(`{"type":"encounterDescribe","eventID":"e2","encounterId":7,"description":"` + strings.Repeat("я", 10001) + `"}`)
	if resp := gm.expect("response", "e2"); resp["code"] != "validation" {
		t.Fatalf("got %v, want a validation error", resp)
	}

	// The notes go to the other tabs only, apart from the state.
	gm.send(`{"type":"encounterDescribe","eventID":"e3","encounterId":7,"description":"Orks in the ruins"}`)
	for _, msg := range until(gm, "encounterState") {
		if strings.Contains(fmt.Sprint(msg), "Orks") {
			t.Errorf("the tab that typed the notes got %v", msg)
		}
	}
	for _, msg := range until(gmOtherTab, "encounterNotes", "encounterState") {
		if msg["type"] == "encounterNotes" && (msg["notes"] != "Orks in the ruins" || msg["encounterId"] != 7.0) {
			t.Errorf("got %v, want the notes of encounter 7", msg)
		}
		if msg["type"] == "encounterState" && strings.Contains(fmt.Sprint(msg), "Orks") {
			t.Errorf("got %v, want a state without the notes", msg)
		}
	}
	gm.send(`{"type":"encounterMove","eventID":"e4","encounterId":7,"participantId":1,"side":"party"}`)
	until(gm, "encounterState", "initiativeView")

	// The notes and the states are the gamemaster's.
	mark()
	for _, msg := range until(player, "initiativeView", "marker") {
		if msg["type"] == "encounterState" || strings.Contains(fmt.Sprint(msg), "Orks") {
			t.Errorf("the player got %v", msg)
		}
	}
}
