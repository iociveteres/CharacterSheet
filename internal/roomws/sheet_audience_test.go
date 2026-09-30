package roomws

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
	"github.com/gorilla/websocket"
)

const (
	gmID = iota + 1
	moderatorID
	ownerID
	playerID
)

// audienceSheets decides who views a sheet the way can_view_character_sheet
// does for room 1; the SQL itself is tested in internal/models.
type audienceSheets struct {
	mocks.CharacterSheetModel
	mu         sync.Mutex
	room       map[int]int
	visibility map[int]models.SheetVisibility
}

func (s *audienceSheets) Audience(ctx context.Context, sheetID int) (*models.SheetAudience, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	room, ok := s.room[sheetID]
	if !ok {
		return nil, models.ErrNoRecord
	}
	viewers := []int{gmID, moderatorID, ownerID}
	switch s.visibility[sheetID] {
	case models.VisibilityEveryoneCanEdit, models.VisibilityEveryoneCanView:
		viewers = append(viewers, playerID)
	}
	return &models.SheetAudience{RoomID: room, Viewers: viewers}, nil
}

func (s *audienceSheets) ChangeVisibility(ctx context.Context, userID, sheetID int, visibility string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.visibility[sheetID] = models.SheetVisibility(visibility)
	return 1, nil
}

// peer is one browser tab in room 1. The hub may send several queued
// messages in one frame, separated by newlines; next returns them one by one.
type peer struct {
	t      *testing.T
	conn   *websocket.Conn
	queued [][]byte
}

func (p *peer) send(msg string) {
	p.t.Helper()
	if err := p.conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
		p.t.Fatalf("write: %v", err)
	}
}

func (p *peer) next() map[string]any {
	p.t.Helper()
	if len(p.queued) == 0 {
		p.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, frame, err := p.conn.ReadMessage()
		if err != nil {
			p.t.Fatalf("read: %v", err)
		}
		p.queued = bytes.Split(frame, newline)
	}
	raw := p.queued[0]
	p.queued = p.queued[1:]
	var msg map[string]any
	if err := json.Unmarshal(raw, &msg); err != nil {
		p.t.Fatalf("unmarshal %q: %v", raw, err)
	}
	return msg
}

// expect reads the next message and checks its type and, if given, eventID.
func (p *peer) expect(typ, eventID string) map[string]any {
	p.t.Helper()
	msg := p.next()
	if msg["type"] != typ || (eventID != "" && msg["eventID"] != eventID) {
		p.t.Fatalf("got %v, want %s %s", msg, typ, eventID)
	}
	return msg
}

type audienceRoom struct {
	server *Server
	sheets *audienceSheets
	dial   func(userID int) *peer
}

func newAudienceRoom(t *testing.T) *audienceRoom {
	t.Helper()
	sheets := &audienceSheets{
		room:       map[int]int{10: 1, 20: 2},
		visibility: map[int]models.SheetVisibility{10: models.VisibilityHideFromPlayers, 20: models.VisibilityEveryoneCanView},
	}
	quiet := log.New(io.Discard, "", 0)
	server := NewServer(&Dependencies{
		Models:   models.Models{CharacterSheets: sheets},
		InfoLog:  quiet,
		ErrorLog: quiet,
	})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, _ := strconv.Atoi(r.URL.Query().Get("user"))
		server.SheetWs(1, userID, w, r)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("BASE_URL", srv.URL)

	hub := server.GetOrInitHub(1)
	dial := func(userID int) *peer {
		t.Helper()
		online := hub.OnlineCount()
		url := fmt.Sprintf("ws%s/?user=%d", strings.TrimPrefix(srv.URL, "http"), userID)
		conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": {srv.URL}})
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		t.Cleanup(func() { conn.Close() })
		for deadline := time.Now().Add(5 * time.Second); hub.OnlineCount() <= online; time.Sleep(5 * time.Millisecond) {
			if time.Now().After(deadline) {
				t.Fatalf("user %d did not register", userID)
			}
		}
		return &peer{t: t, conn: conn}
	}
	return &audienceRoom{server: server, sheets: sheets, dial: dial}
}

// mark sends a marker to every user through the channel the sheet edits take.
// A hub channel keeps order, so an edit queued before the marker arrives
// before it: whoever gets the marker first did not get the edit.
func (r *audienceRoom) mark() {
	r.server.GetOrInitHub(1).BroadcastToUsers(nil, []int{gmID, moderatorID, ownerID, playerID}, []byte(`{"type":"marker"}`))
}

func change(eventID string, sheetID int) string {
	return fmt.Sprintf(`{"type":"change","eventID":%q,"sheetID":"%d","path":"characterInfo.characterName","change":"\"Lorgar\""}`, eventID, sheetID)
}

func TestHiddenSheetEditsSkipPlayers(t *testing.T) {
	room := newAudienceRoom(t)
	gm, moderator, player := room.dial(gmID), room.dial(moderatorID), room.dial(playerID)
	owner, ownerOtherTab := room.dial(ownerID), room.dial(ownerID)

	owner.send(change("e1", 10))
	owner.expect("response", "e1")
	room.mark()

	for _, p := range []*peer{gm, moderator, ownerOtherTab} {
		p.expect("change", "e1")
		p.expect("marker", "")
	}
	player.expect("marker", "")
	// The sender has its answer and does not get its own edit back.
	owner.expect("marker", "")
}

func TestSheetOfAnotherRoomIsRejected(t *testing.T) {
	room := newAudienceRoom(t)
	gm, player := room.dial(gmID), room.dial(playerID)

	gm.send(change("e1", 20))
	if resp := gm.expect("response", "e1"); resp["OK"] != false || resp["code"] != "validation" {
		t.Fatalf("got %v, want a validation error", resp)
	}
	room.mark()
	player.expect("marker", "")
}

func TestPlayerGetsEditsOnceSheetIsVisible(t *testing.T) {
	room := newAudienceRoom(t)
	owner, player := room.dial(ownerID), room.dial(playerID)

	owner.send(`{"type":"changeSheetVisibility","eventID":"v1","sheetID":"10","visibility":"everyone_can_view"}`)
	// The visibility change goes to the whole room, the sender included: once
	// the sender has it, the player has it queued too.
	owner.expect("changeSheetVisibility", "v1")
	player.expect("changeSheetVisibility", "v1")

	owner.send(change("e1", 10))
	owner.expect("response", "e1")
	player.expect("change", "e1")
}
