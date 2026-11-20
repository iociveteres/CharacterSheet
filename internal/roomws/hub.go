package roomws

import (
	"fmt"
	"log"
	"slices"
	"sync/atomic"
)

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	roomID int
	// ownerID is the user of a bestiary hub (BestiaryWs), 0 for a room's hub.
	ownerID int
	// build is the hash of the bundle of the hub's page, "" for none (Builds).
	build string
	// handlers are the message types the hub's clients may send.
	handlers map[string]wsHandler
	// Registered clients.
	clients map[*Client]bool

	// Inbound messages from the clients.
	broadcast chan broadcastMessage

	// Direct messages to the clients
	direct chan directMessage

	userBroadcast chan userBroadcastMessage

	// Register requests from the clients.
	register chan *Client

	// Unregister requests from clients.
	unregister chan *Client

	// external requests to remove all clients with user ID
	kickUser chan int

	// done is closed when the last client releases the hub; Run then stops.
	done chan struct{}
	// refs counts the clients that acquired the hub, under Server.mu.
	refs int

	infoLog     *log.Logger
	errorLog    *log.Logger
	onlineCount atomic.Int32
}

type directMessage struct {
	target *Client
	data   []byte
}

type broadcastMessage struct {
	sender *Client // may be nil if not excluding anyone
	data   []byte
}

type userBroadcastMessage struct {
	userIDs []int
	sender  *Client
	data    []byte
}

func (h *Hub) Run() {
	for h.step() {
	}
}

// step serves one request and says whether the hub goes on. A panic in it is
// logged and the hub goes on: a hub that stopped would leave its room without
// broadcasts until a restart.
func (h *Hub) step() (running bool) {
	defer func() {
		if v := recover(); v != nil {
			logPanic(h.errorLog, v, fmt.Sprintf("hub of room %d (bestiary of %d)", h.roomID, h.ownerID))
			running = true
		}
	}()
	select {
	case <-h.done:
		// Every client has released the hub; those still here have their
		// unregister queued, and their writePump waits for the send to close.
		for c := range h.clients {
			h.removeClient(c)
		}
		return false

	case client := <-h.register:
		h.clients[client] = true
		h.onlineCount.Add(1)

	case client := <-h.unregister:
		// A client dropped for a full buffer or a kick is already gone.
		if _, ok := h.clients[client]; ok {
			h.removeClient(client)
		}

	case messageBroadcast := <-h.broadcast:
		for client := range h.clients {
			if messageBroadcast.sender != nil && client == messageBroadcast.sender {
				continue
			}

			select {
			case client.send <- messageBroadcast.data:
			default:
				h.removeClient(client)
			}
		}

	case messageDirect := <-h.direct:
		if _, ok := h.clients[messageDirect.target]; !ok {
			break
		}
		select {
		case messageDirect.target.send <- messageDirect.data:
		default:
			h.errorLog.Printf("direct send: client send chan full; closing client (room=%d)", h.roomID)
			h.removeClient(messageDirect.target)
		}

	case messageUser := <-h.userBroadcast:
		for client := range h.clients {
			if !slices.Contains(messageUser.userIDs, client.userID) {
				continue
			}
			// Skip if this is the sender (when sender is set
			if messageUser.sender != nil && client == messageUser.sender {
				continue
			}
			select {
			case client.send <- messageUser.data:
			default:
				h.errorLog.Printf("user broadcast: client send chan full; closing client (room=%d, user=%d)", h.roomID, client.userID)
				h.removeClient(client)
			}
		}

	case userID := <-h.kickUser:
		for c := range h.clients {
			if c.userID != userID {
				continue
			}
			h.infoLog.Printf("kicking client user=%d room=%d", userID, h.roomID)

			h.removeClient(c)
			_ = c.conn.Close()
		}
	}
	return true
}

// removeClient takes a registered client out of the hub; closing its send
// channel makes its writePump close the connection.
func (h *Hub) removeClient(c *Client) {
	delete(h.clients, c)
	close(c.send)
	h.onlineCount.Add(-1)
}

// The sends below wait for Run to take the message: a dropped one would
// leave a tab apart from the database until it reloads, and Run never
// blocks, since it drops a client whose buffer is full instead of waiting
// on it. None of them may be called from Run. done ends the wait once the
// hub stopped: no one is left to tell.

func (h *Hub) KickUser(userID int) {
	select {
	case h.kickUser <- userID:
	case <-h.done:
	}
}

func (h *Hub) ReplyToClient(target *Client, message []byte) {
	select {
	case h.direct <- directMessage{target: target, data: message}:
	case <-h.done:
	}
}

// BroadcastAll sends message to all clients
func (h *Hub) BroadcastAll(message []byte) {
	select {
	case h.broadcast <- broadcastMessage{sender: nil, data: message}:
	case <-h.done:
	}
}

// BroadcastFrom sends message to everyone except `sender`
func (h *Hub) BroadcastFrom(sender *Client, message []byte) {
	select {
	case h.broadcast <- broadcastMessage{sender: sender, data: message}:
	case <-h.done:
	}
}

// BroadcastToUser sends message to all clients with the given userID
func (h *Hub) BroadcastToUser(userID int, message []byte) {
	select {
	case h.userBroadcast <- userBroadcastMessage{userIDs: []int{userID}, sender: nil, data: message}:
	case <-h.done:
	}
}

func (h *Hub) BroadcastFromToUser(sender *Client, userID int, message []byte) {
	select {
	case h.userBroadcast <- userBroadcastMessage{userIDs: []int{userID}, sender: sender, data: message}:
	case <-h.done:
	}
}

// BroadcastToUsers sends message to the clients of the given users except
// `sender` (nil excludes no one): the edits of a sheet go only to those who may
// view it.
func (h *Hub) BroadcastToUsers(sender *Client, userIDs []int, message []byte) {
	select {
	case h.userBroadcast <- userBroadcastMessage{userIDs: userIDs, sender: sender, data: message}:
	case <-h.done:
	}
}

func (h *Hub) OnlineCount() int {
	return int(h.onlineCount.Load())
}
