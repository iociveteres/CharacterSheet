package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/internal/models"
)

// SheetWs handles websocket requests from the peer.
func (app *application) SheetWs(roomID int, w http.ResponseWriter, r *http.Request) {
	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	hub := app.hubMap[roomID]

	client := &Client{
		hub:         hub,
		conn:        conn,
		send:        make(chan []byte, 256),
		infoLog:     app.infoLog,
		sheetsModel: app.characterSheets,
		userID:      userID,
	}
	client.hub.register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}

type newCharacterSheetMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
}

type newCharacterSheetCreatedMsg struct {
	Type      string    `json:"type"`
	EventID   string    `json:"eventID"`
	Name      string    `json:"name"`
	UpdatedAt time.Time `json:"updated"`
	CreatedAt time.Time `json:"created"`
}

func newCharacterSheetHandler(ctx context.Context, model models.CharacterSheetModelInterface, hub *Hub, userID int, raw []byte) error {
	var msg newCharacterSheetMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		return fmt.Errorf("unmarshal create-item message: %w", err)
	}

	if msg.Type != "newCharacter" {
		return fmt.Errorf("unexpected message type: %q", msg.Type)
	}

	// first persist in DB
	sheetID, err := model.Insert(ctx, userID, hub.roomID)
	if err != nil {
		return fmt.Errorf("CreateItem: %w", err)
	}

	//  then broadcast
	if hub != nil {
		select {
		// TO DO: broadcast not raw, but all that needed to display sheet entry
		case hub.broadcast <- raw:
		default:
			// drop if hub busy
		}
		if hub.infoLog != nil {
			hub.infoLog.Printf("sheet deleted sheet=%d", sheetID)
		}
	}

	return nil
}

type deleteCharacterSheetMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	SheetID string `json:"sheetID"`
}

func deleteCharacterSheetHandler(ctx context.Context, model models.CharacterSheetModelInterface, hub *Hub, raw []byte) error {
	var msg deleteCharacterSheetMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		return fmt.Errorf("unmarshal deleteCharacter message: %w", err)
	}

	if msg.Type != "deleteCharacter" {
		return fmt.Errorf("unexpected message type: %q", msg.Type)
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		return fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err)
	}

	// TO DO: add ownership checks

	// first persist in DB
	if _, err := model.Delete(ctx, sheetID); err != nil {
		return fmt.Errorf("CreateItem: %w", err)
	}

	//  then broadcast
	if hub != nil {
		select {
		case hub.broadcast <- raw:
		default:
			// drop if hub busy
		}
		if hub.infoLog != nil {
			hub.infoLog.Printf("sheet deleted sheet=%d", sheetID)
		}
	}

	return nil
}

	return nil
