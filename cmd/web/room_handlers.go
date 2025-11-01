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
	"github.com/google/uuid"
)

// SheetWs handles websocket requests from the peer.
func (app *application) SheetWs(roomID int, w http.ResponseWriter, r *http.Request) {
	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
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
	Type      string    `json:"type"`
	EventID   string    `json:"eventID"`
	UserID    int       `json:"userID"`
	SheetID   int       `json:"sheetID"`
	Name      string    `json:"name"`
	UpdatedAt time.Time `json:"updated"`
	CreatedAt time.Time `json:"created"`
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
		UpdatedAt: s.UpdatedAt,
		CreatedAt: s.CreatedAt,
	}

	sheetCreatedJSON, err := json.Marshal(sheetCreated)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal newCharacter created message: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("New sheet created=%d", sheetID)
	hub.BroadcastAll(sheetCreatedJSON)
}

func (app *application) importedCharacterSheetHandler(ctx context.Context, hub *Hub, sheetID int) {
	s, err := app.models.CharacterSheets.Get(ctx, sheetID)
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

	if _, err := app.models.CharacterSheets.Delete(ctx, client.userID, sheetID); err != nil {
		if err == models.ErrPermissionDenied {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "permission", http.StatusForbidden))
			return
		}
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("delete character sheet: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("sheet deleted sheet=%d", sheetID)
	hub.BroadcastAll(raw)
}

type newInviteLinkMsg struct {
	Type          string `json:"type"`
	EventID       string `json:"eventID"`
	ExpiresInDays *int   `json:"ExpiresInDays"`
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
		if *msg.MaxUses == 0 {
			msg.MaxUses = nil
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
		Link:      makeInviteLink(newRoomInvite.Token, app.baseURL),
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

type newPlayerMsg struct {
	Type     string    `json:"type"`
	EventID  string    `json:"eventID"`
	UserID   int       `json:"userID"`
	Name     string    `json:"name"`
	JoinedAt time.Time `json:"joined"`
}

func (app *application) newPlayerHandler(hub *Hub, userID int, name string, joinedAt time.Time) {
	newPlayer := &newPlayerMsg{
		Type:     "newPlayer",
		EventID:  uuid.New().String(),
		UserID:   userID,
		Name:     name,
		JoinedAt: joinedAt,
	}

	newPlayerJSON, err := json.Marshal(newPlayer)
	if err != nil {
		app.errorLog.Print(err)
		return
	}

	hub.BroadcastAll(newPlayerJSON)
}

type kickPlayerMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	UserID  int    `json:"userID"`
}

func (app *application) kickPlayerHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg kickPlayerMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal kickPlayer message: %w", err), "", "validation"))
		return
	}

	err := app.models.RoomMembers.Remove(ctx, client.userID, hub.roomID, msg.UserID)
	if err != nil {
		if err == models.ErrNoRecord {
			hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("no user with this ID: %w", err), "", "validation"))
			return
		} else {
			hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("user remove: %w", err), "", "internal"))
			return
		}
	}

	hub.BroadcastAll(raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, -1))

	go func() {
		time.Sleep(2 * time.Second)
		hub.KickUser(msg.UserID)
	}()
}

type ChangePlayerRoleMsg struct {
	Type    string          `json:"type"`
	EventID string          `json:"eventID"`
	UserID  int             `json:"userID"`
	Role    models.RoomRole `json:"role,omitempty"`
}

func (app *application) changePlayerRoleHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg ChangePlayerRoleMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal changePlayerRole message: %w", err), "", "validation"))
		return
	}

	err := app.models.RoomMembers.ChangeRole(ctx, client.userID, hub.roomID, msg.UserID, msg.Role)
	if err != nil {
		if err == models.ErrNoRecord {
			hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("no user with this ID: %w", err), "", "validation"))
			return
		} else {
			hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("user remove: %w", err), "", "internal"))
			return
		}
	}

	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, -1))
}

type newChatMessageMsg struct {
	Type        string `json:"type"`
	EventID     string `json:"eventID"`
	MessageBody string `json:"messageBody"`
}

type newChatMessageSentMsg struct {
	Type        string `json:"type"`
	EventID     string `json:"eventID"`
	MessageID   int    `json:"messageId"`
	UserID      int    `json:"userId"`
	UserName    string `json:"userName"`
	MessageBody string `json:"messageBody"`
	CreatedAt   string `json:"created"`
}

func (app *application) chatMessageHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg newChatMessageMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal chatMessage message: %w", err), "", "validation"))
		return
	}

	message, err := app.models.RoomMessages.CreateWithUsername(ctx, client.userID, hub.roomID, msg.MessageBody)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("chatMessage: %w", err), msg.EventID, "internal"))
		return
	}

	chatMessageSent := &newChatMessageSentMsg{
		Type:        "chatMessage",
		EventID:     msg.EventID,
		MessageID:   message.Message.ID,
		UserID:      message.Message.UserID,
		UserName:    message.Username,
		MessageBody: msg.MessageBody,
		CreatedAt:   message.Message.CreatedAt.Format(time.RFC3339),
	}

	chatMessageSentJSON, err := json.Marshal(chatMessageSent)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal chatMessageSent message: %w", err), msg.EventID, "internal"))
		return
	}

	hub.BroadcastAll(chatMessageSentJSON)
}

type chatHistoryMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	From    int    `json:"from"`
	To      int    `json:"to"`
}

type chatHistorySentMsg struct {
	Type        string             `json:"type"`
	EventID     string             `json:"eventID"`
	MessagePage models.MessagePage `json:"messagePage"`
}

func (app *application) chatHistoryHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg chatHistoryMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal chatHistory message: %w", err), "", "validation"))
		return
	}

	messagePage, err := app.models.RoomMessages.GetMessagePage(ctx, hub.roomID, msg.From, msg.To)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("chatHistory: %w", err), msg.EventID, "internal"))
		return
	}

	chatHistorySent := &chatHistorySentMsg{
		Type:        "chatHistory",
		EventID:     msg.EventID,
		MessagePage: *messagePage,
	}

	chatHistorySentJSON, err := json.Marshal(chatHistorySent)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal chatHistorySent message: %w", err), msg.EventID, "internal"))
		return
	}

	hub.ReplyToClient(client, chatHistorySentJSON)
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

	version, err := app.models.CharacterSheets.CreateItem(ctx, client.userID, sheetID, pathParts, msg.ItemID, itemPosObj, initObj)
	if err != nil {
		if err == models.ErrPermissionDenied {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "permission", http.StatusForbidden))
			return
		}
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

	version, err := app.models.CharacterSheets.ChangeField(ctx, client.userID, sheetID, path, msg.Change)
	if err != nil {
		if err == models.ErrPermissionDenied {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "permission", http.StatusForbidden))
			return
		}
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

	version, err := app.models.CharacterSheets.ApplyBatch(ctx, client.userID, sheetID, path, msg.Changes)
	if err != nil {
		if err == models.ErrPermissionDenied {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "permission", http.StatusForbidden))
			return
		}
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

	version, err := app.models.CharacterSheets.ReplacePositions(ctx, client.userID, sheetID, msg.Path, msg.Positions)
	if err != nil {
		if err == models.ErrPermissionDenied {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "permission", http.StatusForbidden))
			return
		}
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

	version, err := app.models.CharacterSheets.DeleteItem(ctx, client.userID, sheetID, path)
	if err != nil {
		if err == models.ErrPermissionDenied {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "permission", http.StatusForbidden))
			return
		}
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("deleteItem: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("Item deleted: sheet=%d path=%s", sheetID, msg.Path)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}
