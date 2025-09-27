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
		errorLog:    app.errorLog,
		sheetsModel: app.characterSheets,
		userID:      userID,
	}
	hub.register <- client

	go client.writePump(app)
	go client.readPump(app)
}

type newCharacterSheetMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
}

type newCharacterSheetCreatedMsg struct {
	Type      string `json:"type"`
	EventID   string `json:"eventID"`
	UserID    int    `json:"userID"`
	SheetID   int    `json:"sheetID"`
	Name      string `json:"name"`
	UpdatedAt string `json:"updated"`
	CreatedAt string `json:"created"`
}

func (app *application) newCharacterSheetHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg newCharacterSheetMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal newCharacter message: %w", err), "", "validation"))
		return
	}

	sheetID, err := client.sheetsModel.Insert(ctx, client.userID, hub.roomID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("insert new character sheet: %w", err), msg.EventID, "internal"))
		return
	}

	s, err := client.sheetsModel.Get(ctx, sheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("get created sheet error: %w", err), msg.EventID, "internal"))
		return
	}

	sheetCreated := &newCharacterSheetCreatedMsg{
		Type:      "newCharacterItem",
		EventID:   msg.EventID,
		UserID:    client.userID,
		SheetID:   s.ID,
		Name:      s.CharacterName,
		UpdatedAt: humanDate(s.UpdatedAt),
		CreatedAt: humanDate(s.CreatedAt),
	}

	sheetCreatedJSON, err := json.Marshal(sheetCreated)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal newCharacter created message: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("New sheet created=%d", sheetID)
	hub.BroadcastAll(sheetCreatedJSON)
}

type deleteCharacterSheetMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	SheetID string `json:"sheetID"`
}

func (app *application) deleteCharacterSheetHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	// TO DO: add ownership checks

	if _, err := client.sheetsModel.Delete(ctx, sheetID); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("delete character sheet: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("sheet deleted sheet=%d", sheetID)
	hub.BroadcastAll(raw)
}

type CreateItemMsg struct {
	Type    string          `json:"type"`
	EventID string          `json:"eventID"`
	SheetID string          `json:"sheetID"`
	Path    string          `json:"path"` // dot-separated path
	ItemID  string          `json:"itemId"`
	ItemPos models.Position `json:"itemPos"`
	Init    []string        `json:"init,omitempty"` // relative dot-paths, e.g. "tabs.tab-1"
}

func (app *application) CreateItemHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg CreateItemMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		// can't extract eventID if unmarshal fails, pass empty eventID
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal createItem message: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	pathParts := parseJSONBPath(msg.Path)
	if len(pathParts) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	itemPosObj, err := json.Marshal(msg.ItemPos)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal ItemPos: %w", err), msg.EventID, "internal"))
		return
	}

	initObj, err := buildInitFromRelPaths(msg.Init)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("build init object: %w", err), msg.EventID, "validation"))
		return
	}

	version, err := client.sheetsModel.CreateItem(ctx, sheetID, pathParts, msg.ItemID, itemPosObj, initObj)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("createItem: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("createItem persisted sheet=%d path=%s item=%s", sheetID, msg.Path, msg.ItemID)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type changeMsg struct {
	Type    string          `json:"type"`
	EventID string          `json:"eventID"`
	SheetID string          `json:"sheetID"`
	Version int             `json:"version"`
	Path    string          `json:"path"`
	Change  json.RawMessage `json:"change"`
}

func (app *application) changeHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg changeMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal change message: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	path := parseJSONBPath(msg.Path)
	if len(path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	version, err := client.sheetsModel.ChangeField(ctx, sheetID, path, msg.Change)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("change field: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("Changed value sheet=%d path=%s change=%s", sheetID, msg.Path, msg.Change)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type batchMsg struct {
	Type    string          `json:"type"`
	EventID string          `json:"eventID"`
	SheetID string          `json:"sheetID"`
	Version int             `json:"version"`
	Path    string          `json:"path"`
	Changes json.RawMessage `json:"changes"`
}

func (app *application) batchHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg batchMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal batch message: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	path := parseJSONBPath(msg.Path)
	if len(path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	version, err := client.sheetsModel.ApplyBatch(ctx, sheetID, path, msg.Changes)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("batch change: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("Batch applied sheet=%d path=%s batch=%s", sheetID, msg.Path, string(msg.Changes))
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type positionsChangedMsg struct {
	Type      string                     `json:"type"`
	EventID   string                     `json:"eventID"`
	SheetID   string                     `json:"sheetID"`
	Version   int                        `json:"version"`
	Path      string                     `json:"path"`
	Positions map[string]models.Position `json:"positions"`
}

func (app *application) positionsChangedHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg positionsChangedMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal positionsChanged message: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	if len(msg.Path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	version, err := client.sheetsModel.ReplacePositions(ctx, sheetID, msg.Path, msg.Positions)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("replace positions: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("positionsChanged applied: sheet=%d path=%s", sheetID, msg.Path)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type deleteItemMsg struct {
	Type      string                     `json:"type"`
	EventID   string                     `json:"eventID"`
	SheetID   string                     `json:"sheetID"`
	Version   int                        `json:"version"`
	Path      string                     `json:"path"`
	Positions map[string]models.Position `json:"positions"`
}

func (app *application) deleteItemHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg deleteItemMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal deleteItem message: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	path := parseJSONBPath(msg.Path)
	if len(path) < 2 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("path must contain at least gridID and itemID"), msg.EventID, "validation"))
		return
	}

	version, err := client.sheetsModel.DeleteItem(ctx, sheetID, path)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("deleteItem: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("Item deleted: sheet=%d path=%s", sheetID, msg.Path)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}
