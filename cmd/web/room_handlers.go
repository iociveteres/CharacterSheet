package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/validator"
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
		hub:      hub,
		conn:     conn,
		send:     make(chan []byte, 256),
		infoLog:  app.infoLog,
		errorLog: app.errorLog,
		userID:   userID,
		timeZone: getTimeLocation(r),
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

	sheetID, err := app.models.CharacterSheets.Insert(ctx, client.userID, hub.roomID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("insert new character sheet: %w", err), msg.EventID, "internal"))
		return
	}

	s, err := app.models.CharacterSheets.Get(ctx, sheetID)
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
		UpdatedAt: humanDate(s.UpdatedAt, client.timeZone),
		CreatedAt: humanDate(s.CreatedAt, client.timeZone),
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

	if _, err := app.models.CharacterSheets.Delete(ctx, sheetID); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("delete character sheet: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("sheet deleted sheet=%d", sheetID)
	hub.BroadcastAll(raw)
}

type newInviteLinkMsg struct {
	Type          string `json:"type"`
	EventID       string `json:"eventID"`
	ExpiresInDays *int   `json:"eExpiresInDays"`
	MaxUses       *int   `json:"MaxUses"`
}

type newInviteLinkCreatedMsg struct {
	Type      string     `json:"type"`
	EventID   string     `json:"eventID"`
	Link      string     `json:"link"`
	CreatedAt time.Time  `json:"created"`
	ExpiresAt *time.Time `json:"expiresAt"`
	MaxUses   *int       `json:"MaxUses"`
}

func (app *application) newInviteLinkHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg newInviteLinkMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal newInviteLink message: %w", err), "", "validation"))
		return
	}

	var expiresAt *time.Time
	expiresInDays := 0
	if msg.ExpiresInDays != nil {
		expiresInDays = *msg.ExpiresInDays
		if expiresInDays < 0 {
			hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("expiresInDays cannot be negative"), msg.EventID, "validation"))
			return
		}
		t := time.Now().Add(time.Duration(expiresInDays) * 24 * time.Hour)
		expiresAt = &t
	}

	maxUses := 0
	if msg.MaxUses != nil {
		maxUses = *msg.MaxUses
		if maxUses < 0 {
			hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("maxUses cannot be negative"), msg.EventID, "validation"))
			return
		}
	}

	newRoomInvite, err := app.models.RoomInvites.CreateOrReplaceInvite(ctx, hub.roomID, expiresAt, msg.MaxUses)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("newInviteLink: %w", err), msg.EventID, "internal"))
		return
	}

	newInviteLinkCreated := &newInviteLinkCreatedMsg{
		Type:      "newInviteLink",
		EventID:   msg.EventID,
		Link:      makeInviteLink(newRoomInvite.Token, hub.origin),
		CreatedAt: newRoomInvite.CreatedAt,
		ExpiresAt: newRoomInvite.ExpiresAt,
		MaxUses:   newRoomInvite.MaxUses,
	}

	newInviteLinkCreatedJSON, err := json.Marshal(newInviteLinkCreated)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal newCharacter created message: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("invite link created for room %d", hub.roomID)
	hub.ReplyToClient(client, newInviteLinkCreatedJSON)
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

	version, err := app.models.CharacterSheets.CreateItem(ctx, sheetID, pathParts, msg.ItemID, itemPosObj, initObj)
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

	err = validator.ValidateField(msg.Path, msg.Change)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(err, msg.EventID, "validation"))
		return
	}

	path := parseJSONBPath(msg.Path)
	if len(path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	version, err := app.models.CharacterSheets.ChangeField(ctx, sheetID, path, msg.Change)
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

	err = validator.ValidateBatch(msg.Path, msg.Changes)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(err, msg.EventID, "validation"))
		return
	}

	path := parseJSONBPath(msg.Path)
	if len(path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	version, err := app.models.CharacterSheets.ApplyBatch(ctx, sheetID, path, msg.Changes)
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

	version, err := app.models.CharacterSheets.ReplacePositions(ctx, sheetID, msg.Path, msg.Positions)
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

	version, err := app.models.CharacterSheets.DeleteItem(ctx, sheetID, path)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("deleteItem: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("Item deleted: sheet=%d path=%s", sheetID, msg.Path)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}
