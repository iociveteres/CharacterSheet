package roomws

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// The sockets of a user scheduled for deletion close in the hubs of the rooms named and in the
// user's bestiary hub; the sockets of others stay.
func TestServerKickUser(t *testing.T) {
	quiet := log.New(io.Discard, "", 0)
	server := NewServer(&Dependencies{InfoLog: quiet, ErrorLog: quiet})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, _ := strconv.Atoi(r.URL.Query().Get("user"))
		if room, _ := strconv.Atoi(r.URL.Query().Get("room")); room != 0 {
			server.SheetWs(room, user, w, r)
			return
		}
		server.BestiaryWs(user, w, r)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("BASE_URL", srv.URL)
	dial := func(query string) *websocket.Conn {
		t.Helper()
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/?"+query, http.Header{"Origin": {srv.URL}})
		if err != nil {
			t.Fatalf("dial %s: %v", query, err)
		}
		t.Cleanup(func() { conn.Close() })
		return conn
	}

	kicked := []*websocket.Conn{dial("room=1&user=1"), dial("room=2&user=1"), dial("user=1")}
	staying := dial("room=1&user=2")
	waitFor(t, "the sockets register", func() bool { return server.TotalOnlineUsers() == 4 })

	server.KickUser(1, []int{1, 2})
	for i, conn := range kicked {
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		if _, msg, err := conn.ReadMessage(); err == nil {
			t.Errorf("socket %d of the kicked user still open, got %s", i, msg)
		}
	}
	waitFor(t, "the emptied hubs stop", func() bool {
		return server.RoomHub(2) == nil && server.bestiaryHub(1) == nil
	})

	hub := server.RoomHub(1)
	if hub == nil {
		t.Fatal("the hub of the room with another user stopped")
	}
	waitOnline(t, hub, 1)
	marker := `{"type":"marker"}`
	hub.BroadcastAll([]byte(marker))
	staying.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, got, err := staying.ReadMessage(); err != nil || string(got) != marker {
		t.Fatalf("the other user's socket got %s, %v; want the marker", got, err)
	}
}
