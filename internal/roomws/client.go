package roomws

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
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

	// Maximum message size allowed from peer. A larger message closes the
	// connection; the sheet checks its edits against it (sheet/network.ts).
	maxMessageSize = 32 * 1024
)

var (
	newline = []byte{'\n'}
	space   = []byte{' '}
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return origin == os.Getenv("BASE_URL")
	},
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

type wsHandler func(ctx context.Context, client *Client, hub *Hub, raw []byte)

func (server *Server) buildWSHandlerMap() map[string]wsHandler {
	return map[string]wsHandler{
		"newCharacter":          server.newCharacterSheetHandler,
		"deleteCharacter":       server.deleteCharacterSheetHandler,
		"changeSheetVisibility": server.changeSheetVisibilityHandler,
		"createFolder":          server.createFolderHandler,
		"updateFolder":          server.updateFolderHandler,
		"deleteFolder":          server.deleteFolderHandler,
		"reorderFolders":        server.reorderFoldersHandler,
		"moveSheetToFolder":     server.moveSheetToFolderHandler,
		"newInviteLink":         server.newInviteLinkHandler,
		"kickPlayer":            server.kickPlayerHandler,
		"changePlayerRole":      server.changePlayerRoleHandler,
		"chatMessage":           server.chatMessageHandler,
		"deleteMessage":         server.deleteMessageHandler,
		"chatHistory":           server.chatHistoryHandler,
		"createItem":            server.CreateItemHandler,
		"change":                server.changeHandler,
		"batch":                 server.batchHandler,
		"positionsChanged":      server.positionsChangedHandler,
		"deleteItem":            server.deleteItemHandler,
		"moveItemBetweenGrids":  server.moveItemBetweenGridsHandler,
		"dicePresetUpdated":     server.updateDicePresetHandler,
		"autocomplete":          server.autocompleteQueryHandler,
		"autocompleteApply":     server.autocompleteApplyHandler,

		"encounterCreate":          server.encounterCreateHandler,
		"encounterRename":          server.encounterRenameHandler,
		"encounterDelete":          server.encounterDeleteHandler,
		"encounterShow":            server.encounterShowHandler,
		"partyAdd":                 server.partyAddHandler,
		"encounterDuplicate":       server.encounterDuplicateHandler,
		"encounterAddCreature":     server.encounterAddCreatureHandler,
		"encounterRemove":          server.encounterRemoveHandler,
		"encounterSetDisplayName":  server.encounterSetDisplayNameHandler,
		"encounterMove":            server.encounterMoveHandler,
		"encounterDescribe":        server.encounterDescribeHandler,
		"encounterGroup":           server.encounterGroupHandler,
		"encounterUngroup":         server.encounterUngroupHandler,
		"encounterOrder":           server.encounterOrderHandler,
		"encounterDropView":        server.encounterDropViewHandler,
		"encounterNext":            server.encounterNextHandler,
		"encounterPrev":            server.encounterPrevHandler,
		"encounterResetInitiative": server.encounterResetInitiativeHandler,
		"encounterRollInitiative":  server.encounterRollInitiativeHandler,
	}
}

// buildBestiaryHandlerMap is what a /bestiary page sends: the edits of the
// user's own creatures and rolls that go to no chat.
func (server *Server) buildBestiaryHandlerMap() map[string]wsHandler {
	return map[string]wsHandler{
		"createItem":           server.CreateItemHandler,
		"change":               server.changeHandler,
		"batch":                server.batchHandler,
		"positionsChanged":     server.positionsChangedHandler,
		"deleteItem":           server.deleteItemHandler,
		"moveItemBetweenGrids": server.moveItemBetweenGridsHandler,
		"autocomplete":         server.autocompleteQueryHandler,
		"autocompleteApply":    server.autocompleteApplyHandler,
		"roll":                 server.rollHandler,
	}
}

// readPump pumps messages from the websocket connection to the hub.
//
// The application runs readPump in a per-connection goroutine. The application
// ensures that there is at most one reader on a connection by executing all
// reads from this goroutine.
func (c *Client) readPump(app *Server) {
	handlers := c.hub.handlers

	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		message = bytes.TrimSpace(bytes.Replace(message, newline, space, -1))

		var base struct {
			Type    string `json:"type"`
			EventID string `json:"eventID"`
		}
		if err := json.Unmarshal(message, &base); err != nil {
			c.infoLog.Printf("invalid json from client: %v", err)
			continue
		}

		if h, ok := handlers[base.Type]; ok {
			func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				h(ctx, c, c.hub, message)
			}()
		} else {
			c.infoLog.Printf("unknown message type %q from user %d in room %d (bestiary of %d)", base.Type, c.userID, c.hub.roomID, c.hub.ownerID)
			c.hub.ReplyToClient(c, app.wsClientError(base.EventID, "validation", http.StatusBadRequest))
		}
	}
}

// writePump pumps messages from the hub to the websocket connection.
//
// A goroutine running writePump is started for each connection. The
// application ensures that there is at most one writer to a connection by
// executing all writes from this goroutine.
func (c *Client) writePump(server *Server) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			server.DebugLog.Printf("Message sent=%s", message)

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
