package roomws

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"sync/atomic"
	"testing"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/gamedata"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

type bestiaryPages struct {
	server   *Server
	sheets   *audienceSheets
	messages *countedMessages
	dial     func(userID int) *peer
}

// countedMessages counts the chat messages stored.
type countedMessages struct {
	mocks.RoomMessagesModel
	created atomic.Int32
}

func (m *countedMessages) CreateWithUsername(ctx context.Context, userID, roomID int, messageBody string, commandResult, characterName *string) (models.MessageWithName, error) {
	m.created.Add(1)
	return models.MessageWithName{}, nil
}

// newBestiaryPages serves the /bestiary sockets. Sheet 40 is a creature of
// ownerID, 50 one of playerID's (public) collection; 10 is a sheet of room 1
// and 60 an NPC of room 1, which gmID may edit there.
func newBestiaryPages(t *testing.T) *bestiaryPages {
	t.Helper()
	sheets := &audienceSheets{
		room:            map[int]int{10: 1, 40: 0, 50: 0, 60: 1},
		visibility:      map[int]models.SheetVisibility{10: models.VisibilityEveryoneCanEdit, 60: models.VisibilityHideFromPlayers},
		collectionOwner: map[int]int{40: ownerID, 50: playerID},
	}
	messages := &countedMessages{}
	server, dial := serveHubs(t, models.Models{CharacterSheets: sheets, RoomMessages: messages}, func(server *Server, userID int, w http.ResponseWriter, r *http.Request) {
		server.BestiaryWs(userID, w, r)
	}, func(server *Server, userID int) *Hub {
		return server.GetOrInitBestiaryHub(userID)
	})
	return &bestiaryPages{server: server, sheets: sheets, messages: messages, dial: dial}
}

// mark sends a marker to the tabs of the user as mark of audienceRoom does.
func (b *bestiaryPages) mark(userID int) {
	b.server.GetOrInitBestiaryHub(userID).BroadcastToUsers(nil, []int{userID}, []byte(`{"type":"marker"}`))
}

func expectRefused(t *testing.T, p *peer, eventID string) {
	t.Helper()
	if resp := p.expect("response", eventID); resp["OK"] != false || resp["code"] != "validation" {
		t.Fatalf("got %v, want a validation error", resp)
	}
}

func TestCreatureEditsReachOwnersOtherTabs(t *testing.T) {
	b := newBestiaryPages(t)
	tab, otherTab := b.dial(ownerID), b.dial(ownerID)
	player := b.dial(playerID)

	tab.send(change("e1", 40, characterNamePath))
	if resp := tab.expect("response", "e1"); resp["OK"] != true {
		t.Fatalf("got %v", resp)
	}
	b.mark(ownerID)
	b.mark(playerID)

	otherTab.expect("change", "e1")
	otherTab.expect("marker", "")
	tab.expect("marker", "")
	player.expect("marker", "")
	if got := b.sheets.savedSheets(); len(got) != 1 || got[0] != 40 {
		t.Errorf("saved %v, want the creature", got)
	}
}

func TestAutocompleteOfCreatureReachesEveryTab(t *testing.T) {
	b := newBestiaryPages(t)
	idx, skipped := gamedata.NewIndex[gamedata.Condition]([]json.RawMessage{
		json.RawMessage(`{"name":"Blinded","name_ru":"Ослепление","conditions":[]}`),
	})
	if skipped != nil {
		t.Fatal(skipped)
	}
	b.server.Gamedata = &gamedata.Catalog{Conditions: idx}
	tab, otherTab := b.dial(ownerID), b.dial(ownerID)

	tab.send(`{"type":"autocompleteApply","eventID":"a1","sheetID":"40","path":"conditions.items.c1","collection":"conditions","name":"Blinded","base":{}}`)

	// The sender takes the entry from the broadcast too: it has no answer.
	for _, p := range []*peer{tab, otherTab} {
		if msg := p.expect("autocompleteApplied", "a1"); msg["sheetID"] != "40" {
			t.Errorf("got %v", msg)
		}
	}
}

// The bestiary socket edits no sheet of a room, even one the user may edit
// there, and no creature of another user's collection.
func TestBestiaryRejectsOtherSheets(t *testing.T) {
	b := newBestiaryPages(t)
	gm, player := b.dial(gmID), b.dial(playerID)

	for i, sheet := range []int{10, 60, 50} {
		eventID := string(rune('a' + i))
		gm.send(change(eventID, sheet, characterNamePath))
		expectRefused(t, gm, eventID)
	}
	b.mark(playerID)
	player.expect("marker", "")
	if got := b.sheets.savedSheets(); len(got) != 0 {
		t.Errorf("saved %v, want nothing", got)
	}
}

func TestBestiaryTakesNoRoomMessages(t *testing.T) {
	b := newBestiaryPages(t)
	tab := b.dial(ownerID)

	for _, msg := range []string{
		`{"type":"chatMessage","eventID":"c1","messageBody":"/r d100"}`,
		`{"type":"encounterCreate","eventID":"c2","name":"Ambush"}`,
		`{"type":"newCharacter","eventID":"c3"}`,
	} {
		tab.send(msg)
	}
	for _, eventID := range []string{"c1", "c2", "c3"} {
		expectRefused(t, tab, eventID)
	}
}

// A roll goes back to the tab that rolled, as the chat would show it (the
// command is the room's, room/dice.ts), and is stored nowhere.
func TestRollAnswersSenderOnly(t *testing.T) {
	b := newBestiaryPages(t)
	tab, otherTab := b.dial(ownerID), b.dial(ownerID)

	// A d1 rolls the same each time: the result is the chat's to the letter.
	for i, body := range []string{"/r 1d1 vs 50\n>> Agility", "/r 1d1+2\n>> Damage"} {
		eventID := string(rune('a' + i))
		roll, _ := json.Marshal(map[string]string{"type": "roll", "eventID": eventID, "messageBody": body, "characterName": "Ork Boy"})
		tab.send(string(roll))

		got := tab.expect("rollResult", eventID)
		want := commands.ParseAndExecuteCommand(body)
		if got["messageBody"] != body || got["commandResult"] != want.Result || got["characterName"] != "Ork Boy" || got["created"] == "" {
			t.Errorf("got %v, want the result %q", got, want.Result)
		}
		var versus *commands.VersusOutcome
		if v, ok := got["versus"]; ok {
			b, _ := json.Marshal(v)
			json.Unmarshal(b, &versus)
		}
		if !reflect.DeepEqual(versus, want.Versus) {
			t.Errorf("versus %+v, want %+v", versus, want.Versus)
		}
	}

	for i, body := range []string{"hello", "/r 2dx", "/unknown"} {
		eventID := string(rune('x' + i))
		roll, _ := json.Marshal(map[string]string{"type": "roll", "eventID": eventID, "messageBody": body})
		tab.send(string(roll))
		expectRefused(t, tab, eventID)
	}

	b.mark(ownerID)
	otherTab.expect("marker", "")
	if n := b.messages.created.Load(); n != 0 {
		t.Errorf("%d chat messages stored", n)
	}
}

func TestRenameAndDeleteReachOpenTabs(t *testing.T) {
	b := newBestiaryPages(t)
	tab := b.dial(ownerID)

	b.server.CreatureRenamed(ownerID, 40, "Big Ork")
	b.server.CreaturesDeleted(ownerID, []int{40, 41})
	// Others' tabs hear nothing; a user with no page open gets no hub.
	b.server.CreatureRenamed(playerID, 50, "Grot")
	b.server.CreaturesDeleted(playerID, []int{50})

	msg := tab.expect("change", "")
	if msg["sheetID"] != "40" || msg["path"] != characterNamePath || msg["change"] != "Big Ork" {
		t.Errorf("got %v", msg)
	}
	msg = tab.expect("creaturesDeleted", "")
	if ids, _ := json.Marshal(msg["ids"]); string(ids) != "[40,41]" {
		t.Errorf("got %v", msg)
	}
	if b.server.bestiaryHub(playerID) != nil {
		t.Error("a hub was made for a user with no page open")
	}
}
