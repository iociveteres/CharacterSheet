package roomws

import (
	"context"
	"encoding/json"
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
func (s *versionSheets) MoveItemBetweenGrids(ctx context.Context, userID, sheetID int, fromPath, toPath []string, itemID string, toPos json.RawMessage) (int, error) {
	return s.next()
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
		if resp := owner.expect("response", e.eventID); resp["OK"] != true || resp["version"] != want {
			t.Fatalf("%s: answer %v, want OK with version %v", e.eventID, resp, want)
		}
		msg := gm.next()
		if msg["eventID"] != e.eventID || msg["version"] != want || msg[e.field] == nil {
			t.Fatalf("%s: broadcast %v, want version %v and %s", e.eventID, msg, want, e.field)
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
