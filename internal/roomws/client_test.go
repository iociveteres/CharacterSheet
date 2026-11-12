package roomws

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// roomServer serves room 1 over WebSocket; each dial joins it as a new client.
func roomServer(t *testing.T) (*Server, func() *websocket.Conn) {
	t.Helper()
	quiet := log.New(io.Discard, "", 0)
	server := NewServer(&Dependencies{InfoLog: quiet, ErrorLog: quiet})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.SheetWs(1, 1, w, r)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("BASE_URL", srv.URL)

	dial := func() *websocket.Conn {
		t.Helper()
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), http.Header{"Origin": {srv.URL}})
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		t.Cleanup(func() { conn.Close() })
		return conn
	}
	return server, dial
}

func readResponse(t *testing.T, conn *websocket.Conn) WSResponse {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, got, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var resp WSResponse
	if err := json.Unmarshal(got, &resp); err != nil {
		t.Fatalf("unmarshal %q: %v", got, err)
	}
	return resp
}

// A long description is sent in one change message; the connection must take it.
func TestReadPumpTakesLargeMessages(t *testing.T) {
	_, dial := roomServer(t)
	conn := dial()

	// An unknown type is answered only once the whole message is read and parsed.
	msg := `{"type":"echo","eventID":"e1","text":"` + strings.Repeat("x", 20*1024) + `"}`
	if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}

	if resp := readResponse(t, conn); resp.OK || resp.EventID != "e1" {
		t.Fatalf("got %+v, want an error for e1", resp)
	}
}

// Clients act on server events such as autocompleteApplied; one must not be
// able to forge them for the rest of the room.
func TestReadPumpDoesNotRelayUnknownTypes(t *testing.T) {
	server, dial := roomServer(t)
	sender, other := dial(), dial()

	hub := server.RoomHub(1)
	for deadline := time.Now().Add(5 * time.Second); hub.OnlineCount() < 2; time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("clients registered: %d, want 2", hub.OnlineCount())
		}
	}

	forged := `{"type":"autocompleteApplied","eventID":"e1","sheetID":1}`
	if err := sender.WriteMessage(websocket.TextMessage, []byte(forged)); err != nil {
		t.Fatalf("write: %v", err)
	}
	resp := readResponse(t, sender)
	if resp.OK || resp.EventID != "e1" || resp.Code != "validation" {
		t.Fatalf("sender got %+v, want a validation error for e1", resp)
	}

	// The reply comes after readPump dealt with the message, so a relay would
	// already be queued on the broadcast channel ahead of this marker.
	marker := `{"type":"marker"}`
	hub.BroadcastAll([]byte(marker))

	other.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, got, err := other.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != marker {
		t.Fatalf("other client got %s, want only the marker", got)
	}
}

// A handler that panics must not take the server down: the sender gets an
// internal error for that message and the connection serves the next one.
func TestReadPumpSurvivesPanickingHandler(t *testing.T) {
	server, dial := roomServer(t)
	hub := server.acquireRoomHub(1)
	t.Cleanup(func() { server.release(hub) })
	// Under the lock SheetWs takes before readPump reads the map.
	server.mu.Lock()
	hub.handlers = map[string]wsHandler{
		"boom": func(ctx context.Context, client *Client, hub *Hub, raw []byte) {
			var m map[string]int
			m["x"] = 1
		},
		"ping": func(ctx context.Context, client *Client, hub *Hub, raw []byte) {
			hub.ReplyToClient(client, server.wsOK("e2", -1))
		},
	}
	server.mu.Unlock()
	conn := dial()

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"boom","eventID":"e1"}`)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if resp := readResponse(t, conn); resp.OK || resp.EventID != "e1" || resp.Code != "internal" {
		t.Fatalf("got %+v, want an internal error for e1", resp)
	}

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping","eventID":"e2"}`)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if resp := readResponse(t, conn); !resp.OK || resp.EventID != "e2" {
		t.Fatalf("got %+v, want OK for e2", resp)
	}
}

func waitFor(t *testing.T, what string, done func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !done(); time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting until %s", what)
		}
	}
}

// The hub of a room no one is in stops with its goroutine and leaves the map.
func TestHubStopsWithItsLastClient(t *testing.T) {
	server, dial := roomServer(t)
	before := runtime.NumGoroutine()

	conn := dial()
	waitFor(t, "the client registers", func() bool {
		hub := server.RoomHub(1)
		return hub != nil && hub.OnlineCount() == 1
	})
	conn.Close()

	waitFor(t, "the hub is gone", func() bool { return server.RoomHub(1) == nil })
	waitFor(t, "the goroutines end", func() bool { return runtime.NumGoroutine() <= before })
}

// The tabs of a user's bestiary share one hub, released the same way.
func TestBestiaryHubStopsWithItsLastTab(t *testing.T) {
	quiet := log.New(io.Discard, "", 0)
	server := NewServer(&Dependencies{InfoLog: quiet, ErrorLog: quiet})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.BestiaryWs(7, w, r)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("BASE_URL", srv.URL)

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), http.Header{"Origin": {srv.URL}})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	if server.bestiaryHub(7) == nil {
		t.Fatal("no hub for the open tab")
	}
	conn.Close()
	waitFor(t, "the hub is gone", func() bool { return server.bestiaryHub(7) == nil })
}

// One client leaving does not stop the hub the other one is still in.
func TestHubOutlivesAClientThatLeaves(t *testing.T) {
	server, dial := roomServer(t)
	leaving, staying := dial(), dial()
	hub := server.RoomHub(1)
	waitOnline(t, hub, 2)

	leaving.Close()
	waitOnline(t, hub, 1)
	if got := server.RoomHub(1); got != hub {
		t.Fatalf("room hub is %p, want %p", got, hub)
	}

	marker := `{"type":"marker"}`
	hub.BroadcastAll([]byte(marker))
	staying.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, got, err := staying.ReadMessage(); err != nil || string(got) != marker {
		t.Fatalf("staying client got %s, %v; want the marker", got, err)
	}
}

// A refused connection gives back the hub it took.
func TestRefusedConnectionLeavesNoHub(t *testing.T) {
	server, _ := roomServer(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.SheetWs(2, 1, w, r)
	}))
	t.Cleanup(srv.Close)

	if _, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), http.Header{"Origin": {"https://elsewhere"}}); err == nil {
		t.Fatal("dial from another origin succeeded")
	}
	// The refusal reaches the dialer before SheetWs returns.
	waitFor(t, "the hub is gone", func() bool { return server.RoomHub(2) == nil })
}
