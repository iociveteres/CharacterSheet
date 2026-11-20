package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

// versionSheets gives every content write of audienceSheets the next version,
// as the UPDATE of the real model does.
type versionSheets struct {
	*audienceSheets
	version int
}

func (s *versionSheets) next() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.version++
	return s.version, nil
}

func (s *versionSheets) CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos, init json.RawMessage) (int, error) {
	return s.next()
}
func (s *versionSheets) ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error) {
	return s.next()
}
func (s *versionSheets) ApplyBatch(ctx context.Context, userID, sheetID int, path []string, changes []byte) (int, error) {
	return s.next()
}
func (s *versionSheets) DeleteItem(ctx context.Context, userID, sheetID int, path []string) (int, error) {
	return s.next()
}
func (s *versionSheets) ReplacePositions(ctx context.Context, userID, sheetID int, path []string, positions map[string]models.Position) (int, error) {
	return s.next()
}
func (s *versionSheets) MoveItemBetweenGrids(ctx context.Context, userID, sheetID int, fromPath, toPath []string, itemID string, toPos json.RawMessage) (int, json.RawMessage, error) {
	v, err := s.next()
	return v, json.RawMessage(`{"name":"Iron Will"}`), err
}

// Every sheet edit reaches the other tabs with the version its write gave the
// sheet, the one the author gets in its answer, and with the fields it was sent with.
func TestSheetEditsCarryTheirVersion(t *testing.T) {
	sheets := &versionSheets{audienceSheets: &audienceSheets{
		room:       map[int]int{10: 1},
		visibility: map[int]models.SheetVisibility{10: models.VisibilityEveryoneCanEdit},
	}, version: 40}
	_, dial := serveRoom(t, models.Models{CharacterSheets: sheets})
	owner, gm := dial(ownerID), dial(gmID)

	edits := []struct {
		eventID string
		msg     string
		field   string
	}{
		{"e1", `{"type":"createItem","eventID":"e1","sheetID":"10","path":"talents.list.items","itemId":"t1","itemPos":{"colIndex":0,"rowIndex":0},"init":{"name":"Iron Will"}}`, "itemId"},
		{"e2", `{"type":"change","eventID":"e2","sheetID":"10","path":"talents.list.items.t1.name","change":"Iron Will"}`, "path"},
		{"e3", `{"type":"batch","eventID":"e3","sheetID":"10","path":"talents.list.items.t1","changes":{"name":"Hatred"}}`, "changes"},
		{"e4", `{"type":"positionsChanged","eventID":"e4","sheetID":"10","path":"talents.list.items","positions":{"t1":{"colIndex":1,"rowIndex":0}}}`, "positions"},
		{"e5", `{"type":"moveItemBetweenGrids","eventID":"e5","sheetID":"10","fromPath":"talents.list.items","toPath":"traits.list.items","itemId":"t1","toPosition":{"colIndex":0,"rowIndex":0}}`, "toPosition"},
		{"e6", `{"type":"deleteItem","eventID":"e6","sheetID":"10","path":"traits.list.items.t1"}`, "path"},
	}
	for i, e := range edits {
		want := float64(41 + i)
		owner.send(e.msg)
		resp := owner.expect("response", e.eventID)
		if resp["OK"] != true || resp["version"] != want {
			t.Fatalf("%s: answer %v, want OK with version %v", e.eventID, resp, want)
		}
		msg := gm.next()
		if msg["eventID"] != e.eventID || msg["version"] != want || msg[e.field] == nil {
			t.Fatalf("%s: broadcast %v, want version %v and %s", e.eventID, msg, want, e.field)
		}
		// Every tab, the author's too, puts the moved item as the model returned it.
		for _, got := range []map[string]any{msg, resp} {
			if item, _ := got["item"].(map[string]any); e.eventID == "e5" && (item == nil || item["name"] != "Iron Will") {
				t.Fatalf("%s: %v, want the moved item", e.eventID, got)
			}
		}
	}
}

func TestWithVersionKeepsTheMessage(t *testing.T) {
	got := withVersion([]byte(`{"type":"change","path":"a.b","change":{"x":[1,2]},"version":3}`), 7)
	var msg map[string]any
	if err := json.Unmarshal(got, &msg); err != nil {
		t.Fatal(err)
	}
	if msg["version"] != float64(7) || msg["path"] != "a.b" || msg["change"].(map[string]any)["x"].([]any)[1] != float64(2) {
		t.Errorf("got %s", got)
	}
	if bad := []byte(`not json`); string(withVersion(bad, 7)) != "not json" {
		t.Errorf("a message that does not decode changed")
	}
}

// goneSheets has lost every item: each edit lands inside a deleted one, and
// a move to talents.list.items lands in a grid of a deleted one.
type goneSheets struct {
	*audienceSheets
}

func (goneSheets) ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error) {
	return 0, models.ErrGone
}
func (goneSheets) ApplyBatch(ctx context.Context, userID, sheetID int, path []string, changes []byte) (int, error) {
	return 0, models.ErrGone
}
func (goneSheets) CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos, init json.RawMessage) (int, error) {
	return 0, models.ErrGone
}
func (goneSheets) ReplacePositions(ctx context.Context, userID, sheetID int, path []string, positions map[string]models.Position) (int, error) {
	return 0, models.ErrGone
}
func (goneSheets) MoveItemBetweenGrids(ctx context.Context, userID, sheetID int, fromPath, toPath []string, itemID string, toPos json.RawMessage) (int, json.RawMessage, error) {
	if strings.Join(toPath, ".") == "talents.list.items" {
		return 0, nil, models.ErrDestinationGone
	}
	return 0, nil, models.ErrGone
}

// An edit inside an item someone deleted is answered "gone", which the client
// drops silently, and goes to no one.
func TestEditInsideADeletedItemIsGone(t *testing.T) {
	room := newAudienceRoom(t)
	room.server.Models.CharacterSheets = goneSheets{room.sheets}
	owner, gm := room.dial(ownerID), room.dial(gmID)

	owner.send(`{"type":"change","eventID":"e1","sheetID":"10","path":"talents.list.items.t1.name","change":"Hatred"}`)
	owner.send(`{"type":"batch","eventID":"e2","sheetID":"10","path":"talents.list.items.t1","changes":{"name":"Hatred"}}`)
	owner.send(`{"type":"createItem","eventID":"e3","sheetID":"10","path":"talents.list.items.t1.tabs.items","itemId":"x1","itemPos":{"colIndex":0,"rowIndex":0}}`)
	owner.send(`{"type":"positionsChanged","eventID":"e4","sheetID":"10","path":"talents.list.items.t1.tabs.items","positions":{"x1":{"colIndex":0,"rowIndex":0}}}`)
	owner.send(`{"type":"moveItemBetweenGrids","eventID":"e5","sheetID":"10","fromPath":"talents.list.items","toPath":"traits.list.items","itemId":"t1","toPosition":{"colIndex":0,"rowIndex":0}}`)
	owner.send(`{"type":"moveItemBetweenGrids","eventID":"e6","sheetID":"10","fromPath":"traits.list.items","toPath":"talents.list.items","itemId":"t1","toPosition":{"colIndex":0,"rowIndex":0}}`)
	for _, eventID := range []string{"e1", "e2", "e3", "e4", "e5"} {
		if resp := owner.expect("response", eventID); resp["OK"] != false || resp["code"] != "gone" {
			t.Fatalf("got %v, want gone", resp)
		}
	}
	if resp := owner.expect("response", "e6"); resp["OK"] != false || resp["code"] != "destinationGone" {
		t.Fatalf("got %v, want destinationGone", resp)
	}
	room.mark()
	gm.expect("marker", "")
}

// tooLargeSheets refuses every write as the content_size check does; a move
// wraps the error, as MoveItemBetweenGrids does.
type tooLargeSheets struct {
	*audienceSheets
}

func (tooLargeSheets) ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error) {
	return 0, models.ErrSheetTooLarge
}
func (tooLargeSheets) MoveItemBetweenGrids(ctx context.Context, userID, sheetID int, fromPath, toPath []string, itemID string, toPos json.RawMessage) (int, json.RawMessage, error) {
	return 0, nil, fmt.Errorf("create in destination: %w", models.ErrSheetTooLarge)
}

// An edit that would make the sheet too large is answered "tooLarge" and goes to no one.
func TestEditOverTheSizeLimitIsTooLarge(t *testing.T) {
	room := newAudienceRoom(t)
	room.server.Models.CharacterSheets = tooLargeSheets{room.sheets}
	owner, gm := room.dial(ownerID), room.dial(gmID)

	owner.send(`{"type":"change","eventID":"e1","sheetID":"10","path":"notes.text","change":"Blood for the Blood God"}`)
	owner.send(`{"type":"moveItemBetweenGrids","eventID":"e2","sheetID":"10","fromPath":"talents.list.items","toPath":"traits.list.items","itemId":"t1","toPosition":{"colIndex":0,"rowIndex":0}}`)
	for _, eventID := range []string{"e1", "e2"} {
		if resp := owner.expect("response", eventID); resp["OK"] != false || resp["code"] != "tooLarge" {
			t.Fatalf("got %v, want tooLarge", resp)
		}
	}
	room.mark()
	gm.expect("marker", "")
}
