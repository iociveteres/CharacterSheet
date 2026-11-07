package roomws

import (
	"io"
	"log"
	"testing"
	"time"
)

func waitOnline(t *testing.T, hub *Hub, want int) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); hub.OnlineCount() != want; time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("online: %d, want %d", hub.OnlineCount(), want)
		}
	}
}

// A client whose send buffer is full is dropped from the hub; the counter
// behind TotalOnlineUsers must drop with it, and the unregister its readPump
// sends afterwards must not count it twice.
func TestHubCountsEvictedClientsOffline(t *testing.T) {
	sends := map[string]func(*Hub, *Client){
		"broadcast": func(h *Hub, _ *Client) { h.BroadcastAll([]byte("x")) },
		"direct":    func(h *Hub, c *Client) { h.ReplyToClient(c, []byte("x")) },
		"user":      func(h *Hub, c *Client) { h.BroadcastToUser(c.userID, []byte("x")) },
	}
	for name, send := range sends {
		t.Run(name, func(t *testing.T) {
			quiet := log.New(io.Discard, "", 0)
			hub := NewServer(&Dependencies{InfoLog: quiet, ErrorLog: quiet}).newHub()
			go hub.Run()

			full := &Client{hub: hub, send: make(chan []byte, 1), userID: 1}
			full.send <- []byte("queued")
			other := &Client{hub: hub, send: make(chan []byte, 16), userID: 2}
			hub.register <- full
			hub.register <- other
			waitOnline(t, hub, 2)

			send(hub, full)
			waitOnline(t, hub, 1)

			hub.unregister <- full
			hub.unregister <- other
			waitOnline(t, hub, 0)
		})
	}
}
