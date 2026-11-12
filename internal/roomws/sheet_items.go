package roomws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/util"
	"charactersheet.iociveteres.net/internal/validator"
	"golang.org/x/time/rate"
)

// SheetWs handles websocket requests from the peer.
func (app *Server) SheetWs(roomID int, userID int, w http.ResponseWriter, r *http.Request) {
	app.serveClient(app.acquireRoomHub(roomID), userID, w, r)
}

// BestiaryWs is the socket of a /bestiary page of user userID: the edits of
// the user's creatures go to the user's other tabs.
func (app *Server) BestiaryWs(userID int, w http.ResponseWriter, r *http.Request) {
	app.serveClient(app.acquireBestiaryHub(userID), userID, w, r)
}

// helloMessage is the first message of a socket: the page compares the build
// with its own bundle's (ui/static/js/connectionBar.tsx).
type helloMessage struct {
	Type  string `json:"type"`
	Build string `json:"build"`
}

// serveClient connects a client to the hub it acquired; its readPump
// releases the hub when the connection ends.
func (app *Server) serveClient(hub *Hub, userID int, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade has already answered the request with the error.
		app.InfoLog.Printf("socket upgrade: %v", err)
		app.release(hub)
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
	if l := app.MessageLimit; l.PerSecond > 0 {
		client.limiter = rate.NewLimiter(l.PerSecond, l.Burst)
	}
	if hub.build != "" {
		// Queued before the hub knows the client, so nothing goes ahead of it.
		hello, _ := json.Marshal(helloMessage{Type: "hello", Build: hub.build})
		client.send <- hello
	}
	hub.register <- client

	go client.writePump(app)
	go client.readPump(app)
}

func (app *Server) deleteMessageHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg deleteMessageMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "validation", http.StatusBadRequest))
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

// withVersion adds the version the write gave the sheet to the client's
// message: the tabs order concurrent edits of a path by it, as the hub may
// deliver them in any order (ui/static/js/sheet/versions.ts). A message that
// does not decode goes as it came, without a version.
func withVersion(raw []byte, version int) []byte {
	return withFields(raw, map[string]json.RawMessage{"version": json.RawMessage(strconv.Itoa(version))})
}

// withFields sets fields of the client's message; one that does not decode goes as it came.
func withFields(raw []byte, add map[string]json.RawMessage) []byte {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return raw
	}
	for k, v := range add {
		fields[k] = v
	}
	b, err := json.Marshal(fields)
	if err != nil {
		return raw
	}
	return b
}

// The room list names a sheet from the change of this path (room/remote.ts).
const characterNamePath = "characterInfo.characterName"

// sheetEdit is what every edit of a sheet's content carries.
type sheetEdit struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	SheetID string `json:"sheetID"`
}

func (e *sheetEdit) edit() *sheetEdit { return e }

// sheetEditMsg is a message that edits a sheet's content.
type sheetEditMsg interface {
	edit() *sheetEdit
	// parse splits the paths of the decoded message; an error is the client's.
	parse() error
	// shape checks the parsed edit against CharacterSheetContent
	// (models/sheet_paths.go).
	shape() error
}

// readSheetEdit reads an edit of a sheet into msg and returns the sheet and
// who sees its edits, or replies with an error and returns false.
func (app *Server) readSheetEdit(ctx context.Context, client *Client, hub *Hub, raw []byte, msg sheetEditMsg) (int, *models.SheetAudience, bool) {
	base := msg.edit()
	refuse := func(err error) (int, *models.SheetAudience, bool) {
		app.DebugLog.Printf("%s refused: %v", base.Type, err)
		hub.ReplyToClient(client, app.wsClientError(base.EventID, "validation", http.StatusBadRequest))
		return 0, nil, false
	}
	if err := json.Unmarshal(raw, msg); err != nil {
		return refuse(err)
	}
	sheetID, err := strconv.Atoi(base.SheetID)
	if err != nil {
		return refuse(fmt.Errorf("sheetID %q: %w", base.SheetID, err))
	}
	if err := msg.parse(); err != nil {
		return refuse(err)
	}
	audience, ok := app.sheetAudience(ctx, client, hub, sheetID, base.EventID)
	if !ok {
		return 0, nil, false
	}
	// Stage 1 of _prd/robustness/plan.md (2б): an edit that does not fit
	// the content is still written, only logged, until the log stays empty.
	if err := msg.shape(); err != nil {
		app.logOffShape(base.Type, sheetID, err)
	}
	return sheetID, audience, true
}

// logOffShape logs an edit that does not fit the content. The error names
// the path and the kind of the value, never the value.
func (app *Server) logOffShape(msgType string, sheetID int, err error) {
	app.InfoLog.Printf("sheet edit off the content shape: %s sheet=%d %v", msgType, sheetID, err)
}

// sendSheetEdit sends the edit to the recipients, with the version its write
// gave the sheet, and answers the author with an OK.
func (app *Server) sendSheetEdit(client *Client, hub *Hub, recipients []int, raw []byte, eventID string, version int) {
	hub.BroadcastToUsers(client, recipients, withVersion(raw, version))
	hub.ReplyToClient(client, app.wsOK(eventID, version))
}

type CreateItemMsg struct {
	sheetEdit
	Path    string          `json:"path"`
	ItemID  string          `json:"itemId"`
	ItemPos models.Position `json:"itemPos"`
	Init    json.RawMessage `json:"init,omitempty"`
	path    []string
}

func (m *CreateItemMsg) parse() error {
	m.path = models.ParseJSONBPath(m.Path)
	if len(m.path) == 0 {
		return errors.New("empty path")
	}
	return nil
}

func (m *CreateItemMsg) shape() error {
	if _, err := models.CheckSheetGrid(m.path); err != nil {
		return err
	}
	item := append(m.path[:len(m.path):len(m.path)], m.ItemID)
	if _, err := models.CheckSheetItem(item); err != nil {
		return err
	}
	if len(m.Init) == 0 {
		return nil
	}
	return models.CheckSheetValue(item, m.Init)
}

func (app *Server) CreateItemHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg CreateItemMsg
	sheetID, audience, ok := app.readSheetEdit(ctx, client, hub, raw, &msg)
	if !ok {
		return
	}

	itemPosObj, err := json.Marshal(msg.ItemPos)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal ItemPos: %w", err), msg.EventID, "internal"))
		return
	}

	version, err := app.Models.CharacterSheets.CreateItem(ctx, client.userID, sheetID, msg.path, msg.ItemID, itemPosObj, msg.Init)
	if app.wsModelError(hub, client, err, msg.EventID, "createItem") {
		return
	}

	app.DebugLog.Printf("createItem persisted sheet=%d path=%s item=%s", sheetID, msg.Path, msg.ItemID)
	app.sendSheetEdit(client, hub, audience.Viewers, raw, msg.EventID, version)
}

type changeMsg struct {
	sheetEdit
	Path   string          `json:"path"`
	Change json.RawMessage `json:"change"`
	path   []string
}

func (m *changeMsg) parse() error {
	if err := validator.ValidateField(m.Path, m.Change); err != nil {
		return err
	}
	m.path = models.ParseJSONBPath(m.Path)
	return nil
}

func (m *changeMsg) shape() error { return models.CheckSheetChange(m.path, m.Change) }

func (app *Server) changeHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg changeMsg
	sheetID, audience, ok := app.readSheetEdit(ctx, client, hub, raw, &msg)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.ChangeField(ctx, client.userID, sheetID, msg.path, msg.Change)
	if app.wsModelError(hub, client, err, msg.EventID, "change field") {
		return
	}

	app.DebugLog.Printf("Changed value sheet=%d path=%s change=%s", sheetID, msg.Path, msg.Change)
	recipients := audience.Viewers
	if msg.Path == characterNamePath {
		recipients = audience.Named
	}
	app.sendSheetEdit(client, hub, recipients, raw, msg.EventID, version)
}

type batchMsg struct {
	sheetEdit
	Path    string          `json:"path"`
	Changes json.RawMessage `json:"changes"`
	path    []string
}

func (m *batchMsg) parse() error {
	if err := validator.ValidateBatch(m.Path, m.Changes); err != nil {
		return err
	}
	m.path = models.ParseJSONBPath(m.Path)
	if len(m.path) == 0 {
		return errors.New("empty path")
	}
	return nil
}

func (m *batchMsg) shape() error { return models.CheckSheetBatch(m.path, m.Changes) }

func (app *Server) batchHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg batchMsg
	sheetID, audience, ok := app.readSheetEdit(ctx, client, hub, raw, &msg)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.ApplyBatch(ctx, client.userID, sheetID, msg.path, msg.Changes)
	if app.wsModelError(hub, client, err, msg.EventID, "batch change") {
		return
	}

	app.DebugLog.Printf("Batch applied sheet=%d path=%s batch=%s", sheetID, msg.Path, msg.Changes)
	app.sendSheetEdit(client, hub, audience.Viewers, raw, msg.EventID, version)
}

type positionsChangedMsg struct {
	sheetEdit
	Path      string                     `json:"path"`
	Positions map[string]models.Position `json:"positions"`
	path      []string
}

func (m *positionsChangedMsg) parse() error {
	m.path = models.ParseJSONBPath(m.Path)
	if len(m.path) == 0 {
		return errors.New("empty path")
	}
	return nil
}

func (m *positionsChangedMsg) shape() error {
	if _, err := models.CheckSheetGrid(m.path); err != nil {
		return err
	}
	for id := range m.Positions {
		if _, err := models.CheckSheetItem(append(m.path[:len(m.path):len(m.path)], id)); err != nil {
			return err
		}
	}
	return nil
}

func (app *Server) positionsChangedHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg positionsChangedMsg
	sheetID, audience, ok := app.readSheetEdit(ctx, client, hub, raw, &msg)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.ReplacePositions(ctx, client.userID, sheetID, msg.path, msg.Positions)
	if app.wsModelError(hub, client, err, msg.EventID, "replace positions") {
		return
	}

	app.DebugLog.Printf("positionsChanged applied: sheet=%d path=%s", sheetID, msg.Path)
	app.sendSheetEdit(client, hub, audience.Viewers, raw, msg.EventID, version)
}

type moveItemBetweenGridsMsg struct {
	sheetEdit
	FromPath   string          `json:"fromPath"`
	ToPath     string          `json:"toPath"`
	ItemID     string          `json:"itemId"`
	ToPosition models.Position `json:"toPosition"`
	fromPath   []string
	toPath     []string
}

func (m *moveItemBetweenGridsMsg) parse() error {
	m.fromPath = models.ParseJSONBPath(m.FromPath)
	if len(m.fromPath) == 0 {
		return errors.New("empty fromPath")
	}
	m.toPath = models.ParseJSONBPath(m.ToPath)
	if len(m.toPath) == 0 {
		return errors.New("empty toPath")
	}
	return nil
}

func (m *moveItemBetweenGridsMsg) shape() error {
	from, err := models.CheckSheetItem(append(m.fromPath[:len(m.fromPath):len(m.fromPath)], m.ItemID))
	if err != nil {
		return err
	}
	to, err := models.CheckSheetItem(append(m.toPath[:len(m.toPath):len(m.toPath)], m.ItemID))
	if err != nil {
		return err
	}
	if from != to {
		return &models.SheetShapeError{Path: m.ToPath, Reason: fmt.Sprintf("items of %s moved to a grid of %s", from.Name(), to.Name())}
	}
	return nil
}

func (app *Server) moveItemBetweenGridsHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg moveItemBetweenGridsMsg
	sheetID, audience, ok := app.readSheetEdit(ctx, client, hub, raw, &msg)
	if !ok {
		return
	}

	toPosObj, err := json.Marshal(msg.ToPosition)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal ToPosition: %w", err), msg.EventID, "internal"))
		return
	}

	version, item, err := app.Models.CharacterSheets.MoveItemBetweenGrids(ctx, client.userID, sheetID, msg.fromPath, msg.toPath, msg.ItemID, toPosObj)
	if app.wsModelError(hub, client, err, msg.EventID, "moveItemBetweenGrids") {
		return
	}

	app.DebugLog.Printf("Item moved between grids: sheet=%d from=%s to=%s item=%s", sheetID, msg.FromPath, msg.ToPath, msg.ItemID)
	// Every tab, the author's too, puts the item as the database moved it, not
	// its own copy: an edit written just before the move may not have reached it.
	hub.BroadcastToUsers(client, audience.Viewers, withFields(raw, map[string]json.RawMessage{
		"version": json.RawMessage(strconv.Itoa(version)),
		"item":    item,
	}))
	hub.ReplyToClient(client, withFields(app.wsOK(msg.EventID, version), map[string]json.RawMessage{"item": item}))
}

type deleteItemMsg struct {
	sheetEdit
	Path string `json:"path"`
	path []string
}

func (m *deleteItemMsg) parse() error {
	m.path = models.ParseJSONBPath(m.Path)
	if len(m.path) < 2 {
		return errors.New("path must contain at least gridID and itemID")
	}
	return nil
}

func (m *deleteItemMsg) shape() error {
	_, err := models.CheckSheetItem(m.path)
	return err
}

func (app *Server) deleteItemHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg deleteItemMsg
	sheetID, audience, ok := app.readSheetEdit(ctx, client, hub, raw, &msg)
	if !ok {
		return
	}

	version, err := app.Models.CharacterSheets.DeleteItem(ctx, client.userID, sheetID, msg.path)
	if app.wsModelError(hub, client, err, msg.EventID, "deleteItem") {
		return
	}

	app.DebugLog.Printf("Item deleted: sheet=%d path=%s", sheetID, msg.Path)
	app.sendSheetEdit(client, hub, audience.Viewers, raw, msg.EventID, version)
}
