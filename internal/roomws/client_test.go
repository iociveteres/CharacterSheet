package roomws

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// A long description is sent in one change message; the connection must take it.
func TestReadPumpTakesLargeMessages(t *testing.T) {
	quiet := log.New(io.Discard, "", 0)
	server := NewServer(&Dependencies{InfoLog: quiet, ErrorLog: quiet})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.SheetWs(1, 1, w, r)
	}))
	defer srv.Close()
	t.Setenv("BASE_URL", srv.URL)

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), http.Header{"Origin": {srv.URL}})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// A type without a handler goes back to the whole room, the sender included.
	msg := `{"type":"echo","text":"` + strings.Repeat("x", 20*1024) + `"}`
	if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
		t.Fatalf("write: %v", err)
	}

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, got, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != msg {
		t.Fatalf("got %d bytes back, want the %d sent", len(got), len(msg))
	}
}
