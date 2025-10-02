package main

import (
	"log"
)

// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	roomID int
	// Registered clients.
	clients map[*Client]bool

	// Inbound messages from the clients.
	broadcast chan broadcastMessage

	// Direct messages to the clients
	direct chan directMessage

	// Register requests from the clients.
	register chan *Client

	// Unregister requests from clients.
	unregister chan *Client

	infoLog  *log.Logger
	errorLog *log.Logger
}

type directMessage struct {
	target *Client
	data   []byte
}

type broadcastMessage struct {
	sender *Client // may be nil if not excluding anyone
	data   []byte
}

func (app *application) NewRoom(roomID int) *Hub {
	return &Hub{
		roomID:     roomID,
		broadcast:  make(chan broadcastMessage, 256),
		direct:     make(chan directMessage, 256),
		register:   make(chan *Client, 16),
		unregister: make(chan *Client, 16),
		clients:    make(map[*Client]bool),
		infoLog:    app.infoLog,
		errorLog:   app.errorLog,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}

		case messageBroadcast := <-h.broadcast:
			for client := range h.clients {
				if messageBroadcast.sender != nil && client == messageBroadcast.sender {
					continue
				}

				select {
				case client.send <- messageBroadcast.data:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}

		case messageDirect := <-h.direct:
			if _, ok := h.clients[messageDirect.target]; !ok {
				continue
			}
			select {
			case messageDirect.target.send <- messageDirect.data:
			default:
				h.infoLog.Printf("direct send: client send chan full; closing client (room=%d)", h.roomID)
				close(messageDirect.target.send)
				delete(h.clients, messageDirect.target)
			}
		}
	}
}

func (h *Hub) ReplyToClient(target *Client, message []byte) {
	select {
	case h.direct <- directMessage{target: target, data: message}:
	default:
		if h.infoLog != nil {
			h.infoLog.Printf("ReplyToClient: dropping message (hub.direct full) room=%d", h.roomID)
		}
	}
}

// BroadcastAll sends message to all clients
func (h *Hub) BroadcastAll(message []byte) {
	select {
	case h.broadcast <- broadcastMessage{sender: nil, data: message}:
	default:
		if h.infoLog != nil {
			h.infoLog.Printf("BroadcastAll: dropping message (hub.broadcast full) room=%d", h.roomID)
		}
	}
}

// BroadcastFrom sends message to everyone except `sender`
func (h *Hub) BroadcastFrom(sender *Client, message []byte) {
	select {
	case h.broadcast <- broadcastMessage{sender: sender, data: message}:
	default:
		if h.infoLog != nil {
			h.infoLog.Printf("BroadcastFrom: dropping message (hub.broadcast full) room=%d", h.roomID)
		}
	}
}
