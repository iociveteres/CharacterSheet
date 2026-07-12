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
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	hub := app.GetOrInitHub(roomID)

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

	version, err := app.Models.CharacterSheets.CreateItem(ctx, client.userID, sheetID, pathParts, msg.ItemID, itemPosObj, msg.Init)
	if app.wsModelError(hub, client, err, msg.EventID, "createItem") {
		return
	}

	app.InfoLog.Printf("createItem persisted sheet=%d path=%s item=%s", sheetID, msg.Path, msg.ItemID)
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

	version, err := app.Models.CharacterSheets.ChangeField(ctx, client.userID, sheetID, path, msg.Change)
	if app.wsModelError(hub, client, err, msg.EventID, "change field") {
		return
	}

	app.InfoLog.Printf("Changed value sheet=%d path=%s change=%s", sheetID, msg.Path, msg.Change)
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

	version, err := app.Models.CharacterSheets.ApplyBatch(ctx, client.userID, sheetID, path, msg.Changes)
	if app.wsModelError(hub, client, err, msg.EventID, "batch change") {
		return
	}

	app.InfoLog.Printf("Batch applied sheet=%d path=%s batch=%s", sheetID, msg.Path, string(msg.Changes))
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

	version, err := app.Models.CharacterSheets.ReplacePositions(ctx, client.userID, sheetID, models.ParseJSONBPath(msg.Path), msg.Positions)
	if app.wsModelError(hub, client, err, msg.EventID, "replace positions") {
		return
	}

	app.InfoLog.Printf("positionsChanged applied: sheet=%d path=%s", sheetID, msg.Path)
	hub.BroadcastFrom(client, raw)
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

	version, err := app.Models.CharacterSheets.MoveItemBetweenGrids(ctx, client.userID, sheetID, fromPath, toPath, msg.ItemID, toPosObj)
	if app.wsModelError(hub, client, err, msg.EventID, "moveItemBetweenGrids") {
		return
	}

	app.InfoLog.Printf("Item moved between grids: sheet=%d from=%s to=%s item=%s", sheetID, msg.FromPath, msg.ToPath, msg.ItemID)
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

	version, err := app.Models.CharacterSheets.DeleteItem(ctx, client.userID, sheetID, path)
	if app.wsModelError(hub, client, err, msg.EventID, "deleteItem") {
		return
	}

	app.InfoLog.Printf("Item deleted: sheet=%d path=%s", sheetID, msg.Path)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}
