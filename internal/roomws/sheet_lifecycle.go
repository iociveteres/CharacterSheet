package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"github.com/google/uuid"
)

type newCharacterSheetMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
}

type newCharacterSheetCreatedMsg struct {
	Type      string    `json:"type"`
	EventID   string    `json:"eventID"`
	UserID    int       `json:"userID"`
	SheetID   int       `json:"sheetID"`
	Name      string    `json:"name"`
	UpdatedAt time.Time `json:"updated"`
	CreatedAt time.Time `json:"created"`
}

func (app *Server) newCharacterSheetHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg newCharacterSheetMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal newCharacter message: %w", err), "", "validation"))
		return
	}

	sheetID, err := app.Models.CharacterSheets.Insert(ctx, client.userID, hub.roomID)
	if app.wsModelError(hub, client, err, msg.EventID, "insert new character sheet") {
		return
	}

	s, err := app.Models.CharacterSheets.Get(ctx, sheetID)
	if app.wsModelError(hub, client, err, msg.EventID, "get created sheet") {
		return
	}

	sheetCreated := &newCharacterSheetCreatedMsg{
		Type:      "newCharacterItem",
		EventID:   msg.EventID,
		UserID:    client.userID,
		SheetID:   s.ID,
		Name:      s.CharacterName,
		UpdatedAt: s.UpdatedAt,
		CreatedAt: s.CreatedAt,
	}

	sheetCreatedJSON, err := json.Marshal(sheetCreated)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal newCharacter created message: %w", err), msg.EventID, "internal"))
		return
	}

	app.InfoLog.Printf("New sheet created=%d", sheetID)
	hub.BroadcastAll(sheetCreatedJSON)
}

func (app *Server) ImportedCharacterSheetHandler(ctx context.Context, hub *Hub, sheetID int) {
	s, err := app.Models.CharacterSheets.Get(ctx, sheetID)
	if err != nil {
		app.wsServerError(fmt.Errorf("get created sheet error: %w", err), uuid.New().String(), "internal")
		return
	}

	sheetImported := &newCharacterSheetCreatedMsg{
		Type:      "newCharacterItem",
		EventID:   uuid.New().String(),
		UserID:    s.OwnerID,
		SheetID:   s.ID,
		Name:      s.CharacterName,
		UpdatedAt: s.UpdatedAt,
		CreatedAt: s.CreatedAt,
	}

	sheetImportedJSON, err := json.Marshal(sheetImported)
	if err != nil {
		app.wsServerError(fmt.Errorf("marshal character imported message: %w", err), uuid.New().String(), "internal")
		return
	}

	hub.BroadcastAll(sheetImportedJSON)
}

type deleteCharacterSheetMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	SheetID string `json:"sheetID"`
}

func (app *Server) deleteCharacterSheetHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg deleteCharacterSheetMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal deleteCharacter message: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	_, err = app.Models.CharacterSheets.Delete(ctx, client.userID, sheetID)
	if app.wsModelError(hub, client, err, msg.EventID, "delete character sheet") {
		return
	}

	app.InfoLog.Printf("sheet deleted sheet=%d", sheetID)
	hub.BroadcastAll(raw)
}

type changeSheetVisibilityMsg struct {
	Type       string `json:"type"`
	EventID    string `json:"eventID"`
	SheetID    string `json:"sheetID"`
	Visibility string `json:"visibility"`
}

func (app *Server) changeSheetVisibilityHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg changeSheetVisibilityMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal changeSheetVisibility message: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	visibility := models.SheetVisibility(msg.Visibility)
	if !visibility.IsValid() {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid visibility value %q", msg.Visibility), msg.EventID, "validation"))
		return
	}

	_, err = app.Models.CharacterSheets.ChangeVisibility(ctx, client.userID, sheetID, msg.Visibility)
	if app.wsModelError(hub, client, err, msg.EventID, "change sheet visibility") {
		return
	}

	app.InfoLog.Printf("sheet visibility changed sheet=%d visibility=%s", sheetID, msg.Visibility)
	hub.BroadcastAll(raw)
}
