package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/util"
	"charactersheet.iociveteres.net/internal/validator"
)

// SheetWs handles websocket requests from the peer.
func (app *Server) SheetWs(roomID int, userID int, w http.ResponseWriter, r *http.Request) {
	app.serveClient(app.GetOrInitHub(roomID), userID, w, r)
}

// BestiaryWs is the socket of a /bestiary page of user userID: the edits of
// the user's creatures go to the user's other tabs.
func (app *Server) BestiaryWs(userID int, w http.ResponseWriter, r *http.Request) {
	app.serveClient(app.GetOrInitBestiaryHub(userID), userID, w, r)
}

func (app *Server) serveClient(hub *Hub, userID int, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	client := &Client{
		hub:      hub,
		conn:     conn,
		send:     make(chan []byte, 256),
		infoLog:  app.InfoLog,
		errorLog: app.ErrorLog,
		userID:   userID,
		timeZone: util.GetTimeLocation(r),
	}
	hub.register <- client

	go client.writePump(app)
	go client.readPump(app)
}

func (app *Server) deleteMessageHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg deleteMessageMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal deleteMessage message: %w", err), msg.EventID, "validation"))
		return
	}

	err := app.Models.RoomMessages.Remove(ctx, client.userID, hub.roomID, msg.MessageID)
	if app.wsModelError(hub, client, err, msg.EventID, "delete message") {
		return
	}

	hub.BroadcastAll(raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, -1))
}

// sheetAudience returns who in the hub's room gets the edits of the sheet, or
// replies with an error and false. A sheet of another room is rejected: its
// edits would go to this room's clients. The bestiary hub of a user takes
// their own creatures only, and their edits go to the user's other tabs: a
// room's sheet the user may edit there is still edited in its room.
func (app *Server) sheetAudience(ctx context.Context, client *Client, hub *Hub, sheetID int, eventID string) (*models.SheetAudience, bool) {
	audience, err := app.Models.CharacterSheets.Audience(ctx, sheetID)
	if app.wsModelError(hub, client, err, eventID, "sheet audience") {
		return nil, false
	}
	if hub.ownerID != 0 {
		if audience.CollectionOwnerID != hub.ownerID {
			hub.ReplyToClient(client, app.wsClientError(eventID, "validation", http.StatusBadRequest))
			return nil, false
		}
		owner := []int{hub.ownerID}
		return &models.SheetAudience{Viewers: owner, Named: owner, CollectionOwnerID: hub.ownerID}, true
	}
	if audience.RoomID != hub.roomID {
		hub.ReplyToClient(client, app.wsClientError(eventID, "validation", http.StatusBadRequest))
		return nil, false
	}
	return audience, true
}

// The room list names a sheet from the change of this path (room/remote.ts).
const characterNamePath = "characterInfo.characterName"

type CreateItemMsg struct {
	Type    string          `json:"type"`
	EventID string          `json:"eventID"`
	SheetID string          `json:"sheetID"`
	Path    string          `json:"path"`
	ItemID  string          `json:"itemId"`
	ItemPos models.Position `json:"itemPos"`
	Init    json.RawMessage `json:"init,omitempty"`
}

func (app *Server) CreateItemHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg CreateItemMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal createItem message: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	pathParts := models.ParseJSONBPath(msg.Path)
	if len(pathParts) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	itemPosObj, err := json.Marshal(msg.ItemPos)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal ItemPos: %w", err), msg.EventID, "internal"))
		return
	}

	audience, ok := app.sheetAudience(ctx, client, hub, sheetID, msg.EventID)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.CreateItem(ctx, client.userID, sheetID, pathParts, msg.ItemID, itemPosObj, msg.Init)
	if app.wsModelError(hub, client, err, msg.EventID, "createItem") {
		return
	}

	app.DebugLog.Printf("createItem persisted sheet=%d path=%s item=%s", sheetID, msg.Path, msg.ItemID)
	hub.BroadcastToUsers(client, audience.Viewers, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type changeMsg struct {
	Type    string          `json:"type"`
	EventID string          `json:"eventID"`
	SheetID string          `json:"sheetID"`
	Path    string          `json:"path"`
	Change  json.RawMessage `json:"change"`
}

func (app *Server) changeHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	if err = validator.ValidateField(msg.Path, msg.Change); err != nil {
		hub.ReplyToClient(client, app.wsServerError(err, msg.EventID, "validation"))
		return
	}

	path := models.ParseJSONBPath(msg.Path)
	if len(path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	audience, ok := app.sheetAudience(ctx, client, hub, sheetID, msg.EventID)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.ChangeField(ctx, client.userID, sheetID, path, msg.Change)
	if app.wsModelError(hub, client, err, msg.EventID, "change field") {
		return
	}

	app.DebugLog.Printf("Changed value sheet=%d path=%s change=%s", sheetID, msg.Path, msg.Change)
	recipients := audience.Viewers
	if msg.Path == characterNamePath {
		recipients = audience.Named
	}
	hub.BroadcastToUsers(client, recipients, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type batchMsg struct {
	Type    string          `json:"type"`
	EventID string          `json:"eventID"`
	SheetID string          `json:"sheetID"`
	Path    string          `json:"path"`
	Changes json.RawMessage `json:"changes"`
}

func (app *Server) batchHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	if err = validator.ValidateBatch(msg.Path, msg.Changes); err != nil {
		hub.ReplyToClient(client, app.wsServerError(err, msg.EventID, "validation"))
		return
	}

	path := models.ParseJSONBPath(msg.Path)
	if len(path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	audience, ok := app.sheetAudience(ctx, client, hub, sheetID, msg.EventID)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.ApplyBatch(ctx, client.userID, sheetID, path, msg.Changes)
	if app.wsModelError(hub, client, err, msg.EventID, "batch change") {
		return
	}

	app.DebugLog.Printf("Batch applied sheet=%d path=%s batch=%s", sheetID, msg.Path, msg.Changes)
	hub.BroadcastToUsers(client, audience.Viewers, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type positionsChangedMsg struct {
	Type      string                     `json:"type"`
	EventID   string                     `json:"eventID"`
	SheetID   string                     `json:"sheetID"`
	Path      string                     `json:"path"`
	Positions map[string]models.Position `json:"positions"`
}

func (app *Server) positionsChangedHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	audience, ok := app.sheetAudience(ctx, client, hub, sheetID, msg.EventID)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.ReplacePositions(ctx, client.userID, sheetID, models.ParseJSONBPath(msg.Path), msg.Positions)
	if app.wsModelError(hub, client, err, msg.EventID, "replace positions") {
		return
	}

	app.DebugLog.Printf("positionsChanged applied: sheet=%d path=%s", sheetID, msg.Path)
	hub.BroadcastToUsers(client, audience.Viewers, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type moveItemBetweenGridsMsg struct {
	Type       string          `json:"type"`
	EventID    string          `json:"eventID"`
	SheetID    string          `json:"sheetID"`
	FromPath   string          `json:"fromPath"`
	ToPath     string          `json:"toPath"`
	ItemID     string          `json:"itemId"`
	ToPosition models.Position `json:"toPosition"`
}

func (app *Server) moveItemBetweenGridsHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg moveItemBetweenGridsMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal moveItemBetweenGrids message: %w", err), "", "validation"))
		return
	}

	sheetID, err := strconv.Atoi(msg.SheetID)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid sheetID %q: %w", msg.SheetID, err), msg.EventID, "validation"))
		return
	}

	fromPath := models.ParseJSONBPath(msg.FromPath)
	if len(fromPath) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty fromPath"), msg.EventID, "validation"))
		return
	}

	toPath := models.ParseJSONBPath(msg.ToPath)
	if len(toPath) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty toPath"), msg.EventID, "validation"))
		return
	}

	toPosObj, err := json.Marshal(msg.ToPosition)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal ToPosition: %w", err), msg.EventID, "internal"))
		return
	}

	audience, ok := app.sheetAudience(ctx, client, hub, sheetID, msg.EventID)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.MoveItemBetweenGrids(ctx, client.userID, sheetID, fromPath, toPath, msg.ItemID, toPosObj)
	if app.wsModelError(hub, client, err, msg.EventID, "moveItemBetweenGrids") {
		return
	}

	app.DebugLog.Printf("Item moved between grids: sheet=%d from=%s to=%s item=%s", sheetID, msg.FromPath, msg.ToPath, msg.ItemID)
	hub.BroadcastToUsers(client, audience.Viewers, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type deleteItemMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	SheetID string `json:"sheetID"`
	Path    string `json:"path"`
}

func (app *Server) deleteItemHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	path := models.ParseJSONBPath(msg.Path)
	if len(path) < 2 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("path must contain at least gridID and itemID"), msg.EventID, "validation"))
		return
	}

	audience, ok := app.sheetAudience(ctx, client, hub, sheetID, msg.EventID)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.DeleteItem(ctx, client.userID, sheetID, path)
	if app.wsModelError(hub, client, err, msg.EventID, "deleteItem") {
		return
	}

	app.DebugLog.Printf("Item deleted: sheet=%d path=%s", sheetID, msg.Path)
	hub.BroadcastToUsers(client, audience.Viewers, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}
