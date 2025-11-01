package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 4096
)

var (
	newline = []byte{'\n'}
	space   = []byte{' '}
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	hub *Hub
	// The websocket connection.
	conn *websocket.Conn
	// Buffered channel of outbound messages.
	send     chan []byte
	errorLog *log.Logger
	infoLog  *log.Logger
	userID   int
	timeZone *time.Location
}

// readPump pumps messages from the websocket connection to the hub.
//
// The application runs readPump in a per-connection goroutine. The application
// ensures that there is at most one reader on a connection by executing all
// reads from this goroutine.
func (c *Client) readPump(app *application) {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		c.infoLog.Printf("Received from client: %s", string(message))

		message = bytes.TrimSpace(bytes.Replace(message, newline, space, -1))

		var base struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(message, &base); err != nil {
			c.infoLog.Printf("invalid json from client: %v", err)
			continue
		}

		switch base.Type {
		case "newCharacter":
			app.newCharacterSheetHandler(context.Background(), c, c.hub, message)
		case "deleteCharacter":
			app.deleteCharacterSheetHandler(context.Background(), c, c.hub, message)
		case "newInviteLink":
			app.newInviteLinkHandler(context.Background(), c, c.hub, message)
		case "kickPlayer":
			app.kickPlayerHandler(context.Background(), c, c.hub, message)
		case "changePlayerRole":
			app.changePlayerRoleHandler(context.Background(), c, c.hub, message)
		case "chatMessage":
			app.chatMessageHandler(context.Background(), c, c.hub, message)
		case "chatHistory":
			app.chatHistoryHandler(context.Background(), c, c.hub, message)
		case "createItem":
			app.CreateItemHandler(context.Background(), c, c.hub, message)
		case "change":
			app.changeHandler(context.Background(), c, c.hub, message)
		case "batch":
			app.batchHandler(context.Background(), c, c.hub, message)
		case "positionsChanged":
			app.positionsChangedHandler(context.Background(), c, c.hub, message)
		case "deleteItem":
			app.deleteItemHandler(context.Background(), c, c.hub, message)
		default:
			c.hub.BroadcastAll(message)
		}
	}
}

// writePump pumps messages from the hub to the websocket connection.
//
// A goroutine running writePump is started for each connection. The
// application ensures that there is at most one writer to a connection by
// executing all writes from this goroutine.
func (c *Client) writePump(app *application) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			app.infoLog.Printf("Message sent=%s", string(message))

			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Add queued chat messages to the current websocket message.
			n := len(c.send)
			for range n {
				w.Write(newline)
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
