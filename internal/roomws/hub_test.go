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

// stoppedHub is a hub whose Run has not started yet, with the clients already
// in it: messages queue up as they would behind a busy Run.
func stoppedHub(t *testing.T, clients ...*Client) *Hub {
	t.Helper()
	quiet := log.New(io.Discard, "", 0)
	hub := NewServer(&Dependencies{InfoLog: quiet, ErrorLog: quiet}).newHub()
	for _, c := range clients {
		c.hub = hub
		hub.clients[c] = true
		hub.onlineCount.Add(1)
	}
	return hub
}

func receive(t *testing.T, c *Client, n int) {
	t.Helper()
	for i := range n {
		select {
		case <-c.send:
		case <-time.After(5 * time.Second):
			t.Fatalf("got %d messages, want %d", i, n)
		}
	}
}

var hubSends = map[string]func(*Hub, *Client){
	"broadcast": func(h *Hub, _ *Client) { h.BroadcastAll([]byte("x")) },
	"direct":    func(h *Hub, c *Client) { h.ReplyToClient(c, []byte("x")) },
	"user":      func(h *Hub, c *Client) { h.BroadcastToUsers(nil, []int{c.userID}, []byte("x")) },
}

// More messages than the hub's queue holds wait for Run instead of being
// dropped.
func TestHubDeliversEveryMessage(t *testing.T) {
	const n = 1000
	for name, send := range hubSends {
		t.Run(name, func(t *testing.T) {
			reader := &Client{send: make(chan []byte, n), userID: 1}
			hub := stoppedHub(t, reader)
			t.Cleanup(func() { close(hub.done) })

			go func() {
				for range n {
					send(hub, reader)
				}
			}()
			go hub.Run()

			receive(t, reader, n)
		})
	}
}

// A client that does not read is dropped; the others still get everything.
func TestHubDropsOnlyTheClientThatDoesNotRead(t *testing.T) {
	const n = 1000
	stuck := &Client{send: make(chan []byte, 1), userID: 1}
	reader := &Client{send: make(chan []byte, n), userID: 2}
	hub := stoppedHub(t, stuck, reader)
	t.Cleanup(func() { close(hub.done) })

	go func() {
		for range n {
			hub.BroadcastAll([]byte("x"))
		}
	}()
	go hub.Run()

	receive(t, reader, n)
	waitOnline(t, hub, 1)
}

// A send to a hub that stopped returns: it has no one left to tell.
func TestHubSendsReturnOnceStopped(t *testing.T) {
	for name, send := range hubSends {
		t.Run(name, func(t *testing.T) {
			c := &Client{send: make(chan []byte, 1), userID: 1}
			hub := stoppedHub(t, c)
			close(hub.done)

			sent := make(chan struct{})
			go func() {
				for range 1000 {
					send(hub, c)
				}
				close(sent)
			}()
			select {
			case <-sent:
			case <-time.After(5 * time.Second):
				t.Fatal("sends to a stopped hub still wait")
			}
		})
	}
}
