package roomws

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
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

	hub := server.GetOrInitHub(1)
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
