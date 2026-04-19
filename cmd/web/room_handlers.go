package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/gamedata"
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

// wsModelError sends the appropriate reply for a model-layer error.
// Returns true if an error was handled (caller should return).
func (app *application) wsModelError(hub *Hub, client *Client, err error, eventID, context string) bool {
	if err == nil {
		return false
	}
	if err == models.ErrPermissionDenied || err == models.ErrNoRecord {
		hub.ReplyToClient(client, app.wsClientError(eventID, "permission", http.StatusForbidden))
		return true
	}
	hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("%s: %w", context, err), eventID, "internal"))
	return true
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
	if app.wsModelError(hub, client, err, msg.EventID, "insert new character sheet") {
		return
	}

	s, err := app.models.CharacterSheets.Get(ctx, sheetID)
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

	_, err = app.models.CharacterSheets.Delete(ctx, client.userID, sheetID)
	if app.wsModelError(hub, client, err, msg.EventID, "delete character sheet") {
		return
	}

	app.infoLog.Printf("sheet deleted sheet=%d", sheetID)
	hub.BroadcastAll(raw)
}

type changeSheetVisibilityMsg struct {
	Type       string `json:"type"`
	EventID    string `json:"eventID"`
	SheetID    string `json:"sheetID"`
	Visibility string `json:"visibility"`
}

func (app *application) changeSheetVisibilityHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	_, err = app.models.CharacterSheets.ChangeVisibility(ctx, client.userID, sheetID, msg.Visibility)
	if app.wsModelError(hub, client, err, msg.EventID, "change sheet visibility") {
		return
	}

	app.infoLog.Printf("sheet visibility changed sheet=%d visibility=%s", sheetID, msg.Visibility)
	hub.BroadcastAll(raw)
}

type createFolderMsg struct {
	Type       string `json:"type"`
	EventID    string `json:"eventID"`
	Name       string `json:"name"`
	Visibility string `json:"visibility"`
}

type folderCreatedMsg struct {
	Type       string    `json:"type"`
	EventID    string    `json:"eventID"`
	FolderID   int       `json:"folderId"`
	OwnerID    int       `json:"ownerId"`
	Name       string    `json:"name"`
	Visibility string    `json:"visibility"`
	SortOrder  int       `json:"sortOrder"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (app *application) createFolderHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg createFolderMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal createFolder message: %w", err), "", "validation"))
		return
	}

	if len(msg.Name) == 0 || len(msg.Name) > 100 {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "folder name must be between 1 and 100 characters", http.StatusBadRequest))
		return
	}

	visibility := models.SheetVisibility(msg.Visibility)
	if !visibility.IsValid() {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid visibility value %q", msg.Visibility), msg.EventID, "validation"))
		return
	}

	folder, err := app.models.CharacterSheetFolders.Create(ctx, client.userID, hub.roomID, msg.Name, visibility)
	if app.wsModelError(hub, client, err, msg.EventID, "create folder") {
		return
	}

	folderCreated := &folderCreatedMsg{
		Type:       "folderCreated",
		EventID:    msg.EventID,
		FolderID:   folder.ID,
		OwnerID:    folder.OwnerID,
		Name:       folder.Name,
		Visibility: string(folder.Visibility),
		SortOrder:  folder.SortOrder,
		CreatedAt:  folder.CreatedAt,
	}

	folderCreatedJSON, err := json.Marshal(folderCreated)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal folderCreated message: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("Folder created: id=%d owner=%d room=%d", folder.ID, client.userID, hub.roomID)
	hub.BroadcastAll(folderCreatedJSON)
}

type updateFolderMsg struct {
	Type       string `json:"type"`
	EventID    string `json:"eventID"`
	FolderID   int    `json:"folderId"`
	OwnerID    int    `json:"ownerId"`
	Name       string `json:"name"`
	Visibility string `json:"visibility"`
}

func (app *application) updateFolderHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg updateFolderMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal updateFolder message: %w", err), "", "validation"))
		return
	}

	if len(msg.Name) == 0 || len(msg.Name) > 100 {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "folder name must be between 1 and 100 characters", http.StatusBadRequest))
		return
	}

	visibility := models.SheetVisibility(msg.Visibility)
	if !visibility.IsValid() {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("invalid visibility value %q", msg.Visibility), msg.EventID, "validation"))
		return
	}

	err := app.models.CharacterSheetFolders.Update(ctx, client.userID, msg.FolderID, msg.Name, visibility)
	if app.wsModelError(hub, client, err, msg.EventID, "update folder") {
		return
	}

	app.infoLog.Printf("Folder updated: id=%d user=%d", msg.FolderID, client.userID)
	hub.BroadcastAll(raw)
}

type deleteFolderMsg struct {
	Type     string `json:"type"`
	EventID  string `json:"eventID"`
	FolderID int    `json:"folderId"`
}

func (app *application) deleteFolderHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg deleteFolderMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal deleteFolder message: %w", err), "", "validation"))
		return
	}

	err := app.models.CharacterSheetFolders.Delete(ctx, client.userID, msg.FolderID)
	if app.wsModelError(hub, client, err, msg.EventID, "delete folder") {
		return
	}

	app.infoLog.Printf("Folder deleted: id=%d user=%d", msg.FolderID, client.userID)
	hub.BroadcastAll(raw)
}

type reorderFoldersMsg struct {
	Type      string `json:"type"`
	EventID   string `json:"eventID"`
	FolderIDs []int  `json:"folderIds"`
}

func (app *application) reorderFoldersHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg reorderFoldersMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal reorderFolders message: %w", err), "", "validation"))
		return
	}

	err := app.models.CharacterSheetFolders.Reorder(ctx, client.userID, hub.roomID, msg.FolderIDs)
	if app.wsModelError(hub, client, err, msg.EventID, "reorder folders") {
		return
	}

	app.infoLog.Printf("Folders reordered: user=%d room=%d", client.userID, hub.roomID)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, -1))
}

type moveSheetToFolderMsg struct {
	Type     string `json:"type"`
	EventID  string `json:"eventID"`
	SheetID  int    `json:"sheetId"`
	FolderID *int   `json:"folderId"`
}

func (app *application) moveSheetToFolderHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg moveSheetToFolderMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal moveSheetToFolder message: %w", err), "", "validation"))
		return
	}

	err := app.models.CharacterSheetFolders.MoveSheetToFolder(ctx, client.userID, msg.SheetID, msg.FolderID)
	if app.wsModelError(hub, client, err, msg.EventID, "move sheet to folder") {
		return
	}

	app.infoLog.Printf("Sheet moved to folder: sheet=%d folder=%v user=%d", msg.SheetID, msg.FolderID, client.userID)
	hub.BroadcastAll(raw)
}

type updateDicePresetMsg struct {
	Type         string `json:"type"`
	EventID      string `json:"eventID"`
	SlotNumber   int    `json:"slotNumber"`
	DiceNotation string `json:"diceNotation"`
}

type dicePresetUpdatedMsg struct {
	Type         string `json:"type"`
	SlotNumber   int    `json:"slotNumber"`
	DiceNotation string `json:"diceNotation"`
}

func (app *application) updateDicePresetHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg updateDicePresetMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal updateDicePreset: %w", err), "", "validation"))
		return
	}

	if msg.SlotNumber < 1 || msg.SlotNumber > 5 {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "invalid slot number", http.StatusBadRequest))
		return
	}

	notation := strings.TrimSpace(msg.DiceNotation)
	if len(notation) > 100 {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "dice notation too long", http.StatusBadRequest))
		return
	}

	if err := app.models.RoomDicePresets.Upsert(ctx, client.userID, hub.roomID, msg.SlotNumber, notation); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("upsert dice preset: %w", err), msg.EventID, "internal"))
		return
	}

	app.infoLog.Printf("dice preset updated user=%d room=%d slot=%d", client.userID, hub.roomID, msg.SlotNumber)

	outMsg, err := json.Marshal(dicePresetUpdatedMsg{
		Type:         "dicePresetUpdated",
		SlotNumber:   msg.SlotNumber,
		DiceNotation: notation,
	})
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal dicePresetUpdated: %w", err), msg.EventID, "internal"))
		return
	}

	hub.BroadcastFromToUser(client, client.userID, outMsg)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, -1))
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
	if msg.ExpiresInDays != nil {
		if *msg.ExpiresInDays < 0 {
			hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("expiresInDays cannot be negative"), msg.EventID, "validation"))
			return
		}
		t := time.Now().Add(time.Duration(*msg.ExpiresInDays) * 24 * time.Hour)
		expiresAt = &t
	}

	if msg.MaxUses != nil {
		if *msg.MaxUses < 0 {
			hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("maxUses cannot be negative"), msg.EventID, "validation"))
			return
		}
		if *msg.MaxUses == 0 {
			msg.MaxUses = nil
		}
	}

	newRoomInvite, err := app.models.RoomInvites.CreateOrReplaceInvite(ctx, hub.roomID, expiresAt, msg.MaxUses)
	if app.wsModelError(hub, client, err, msg.EventID, "create invite link") {
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
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal newInviteLink created message: %w", err), msg.EventID, "internal"))
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
	if app.wsModelError(hub, client, err, msg.EventID, "kick player") {
		return
	}

	hub.BroadcastAll(raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, -1))

	// Delay gives the client time to receive the broadcast before being disconnected.
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
	if app.wsModelError(hub, client, err, msg.EventID, "change player role") {
		return
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
	Type          string  `json:"type"`
	EventID       string  `json:"eventID"`
	MessageID     int     `json:"messageId"`
	UserID        int     `json:"userId"`
	UserName      string  `json:"userName"`
	MessageBody   string  `json:"messageBody"`
	CommandResult *string `json:"commandResult,omitempty"`
	CreatedAt     string  `json:"created"`
}

func (app *application) chatMessageHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg newChatMessageMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal chatMessage message: %w", err), "", "validation"))
		return
	}

	var commandResult *string
	if strings.HasPrefix(msg.MessageBody, "/") {
		if r := commands.ParseAndExecuteCommand(msg.MessageBody); r.Success {
			commandResult = &r.Result
		}
	}

	message, err := app.models.RoomMessages.CreateWithUsername(ctx, client.userID, hub.roomID, msg.MessageBody, commandResult)
	if app.wsModelError(hub, client, err, msg.EventID, "create chat message") {
		return
	}

	chatMessageSent := &newChatMessageSentMsg{
		Type:          "chatMessage",
		EventID:       msg.EventID,
		MessageID:     message.Message.ID,
		UserID:        message.Message.UserID,
		UserName:      message.Username,
		MessageBody:   msg.MessageBody,
		CommandResult: message.Message.CommandResult,
		CreatedAt:     message.Message.CreatedAt.Format(time.RFC3339),
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
	Offset  int    `json:"offset"`
	Limit   int    `json:"limit"`
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

	limit := msg.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	messagePage, err := app.models.RoomMessages.GetMessagePage(ctx, hub.roomID, msg.Offset, limit)
	if app.wsModelError(hub, client, err, msg.EventID, "get message page") {
		return
	}

	chatHistorySentJSON, err := json.Marshal(&chatHistorySentMsg{
		Type:        "chatHistory",
		EventID:     msg.EventID,
		MessagePage: *messagePage,
	})
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal chatHistorySent message: %w", err), msg.EventID, "internal"))
		return
	}

	hub.ReplyToClient(client, chatHistorySentJSON)
}

type deleteMessageMsg struct {
	Type      string `json:"type"`
	EventID   string `json:"eventID"`
	MessageID int    `json:"messageId"`
}

func (app *application) deleteMessageHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg deleteMessageMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal deleteMessage message: %w", err), msg.EventID, "validation"))
		return
	}

	err := app.models.RoomMessages.Remove(ctx, client.userID, hub.roomID, msg.MessageID)
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

func (app *application) CreateItemHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	version, err := app.models.CharacterSheets.CreateItem(ctx, client.userID, sheetID, pathParts, msg.ItemID, itemPosObj, msg.Init)
	if app.wsModelError(hub, client, err, msg.EventID, "createItem") {
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

	if err = validator.ValidateField(msg.Path, msg.Change); err != nil {
		hub.ReplyToClient(client, app.wsServerError(err, msg.EventID, "validation"))
		return
	}

	path := parseJSONBPath(msg.Path)
	if len(path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	version, err := app.models.CharacterSheets.ChangeField(ctx, client.userID, sheetID, path, msg.Change)
	if app.wsModelError(hub, client, err, msg.EventID, "change field") {
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

	if err = validator.ValidateBatch(msg.Path, msg.Changes); err != nil {
		hub.ReplyToClient(client, app.wsServerError(err, msg.EventID, "validation"))
		return
	}

	path := parseJSONBPath(msg.Path)
	if len(path) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty path"), msg.EventID, "validation"))
		return
	}

	version, err := app.models.CharacterSheets.ApplyBatch(ctx, client.userID, sheetID, path, msg.Changes)
	if app.wsModelError(hub, client, err, msg.EventID, "batch change") {
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

	version, err := app.models.CharacterSheets.ReplacePositions(ctx, client.userID, sheetID, parseJSONBPath(msg.Path), msg.Positions)
	if app.wsModelError(hub, client, err, msg.EventID, "replace positions") {
		return
	}

	app.infoLog.Printf("positionsChanged applied: sheet=%d path=%s", sheetID, msg.Path)
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

func (app *application) moveItemBetweenGridsHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	fromPath := parseJSONBPath(msg.FromPath)
	if len(fromPath) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty fromPath"), msg.EventID, "validation"))
		return
	}

	toPath := parseJSONBPath(msg.ToPath)
	if len(toPath) == 0 {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("empty toPath"), msg.EventID, "validation"))
		return
	}

	toPosObj, err := json.Marshal(msg.ToPosition)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal ToPosition: %w", err), msg.EventID, "internal"))
		return
	}

	version, err := app.models.CharacterSheets.MoveItemBetweenGrids(ctx, client.userID, sheetID, fromPath, toPath, msg.ItemID, toPosObj)
	if app.wsModelError(hub, client, err, msg.EventID, "moveItemBetweenGrids") {
		return
	}

	app.infoLog.Printf("Item moved between grids: sheet=%d from=%s to=%s item=%s", sheetID, msg.FromPath, msg.ToPath, msg.ItemID)
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
	if app.wsModelError(hub, client, err, msg.EventID, "deleteItem") {
		return
	}

	app.infoLog.Printf("Item deleted: sheet=%d path=%s", sheetID, msg.Path)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, version))
}

type autocompleteMsg struct {
	Type       string `json:"type"`
	EventID    string `json:"eventID"`
	Collection string `json:"collection"` // e.g. "advancements"
	Query      string `json:"query"`
	Filter     string `json:"filter,omitempty"` // optional; collection-specific subtype filter
}

func (app *application) autocompleteQueryHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg autocompleteMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(
			fmt.Errorf("unmarshal autocomplete: %w", err), "", "validation",
		))
		return
	}

	var results any
	switch msg.Collection {
	case "advancements":
		if app.gamedata == nil || app.gamedata.Advancements == nil {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "not_found", http.StatusNotFound))
			return
		}
		r := app.gamedata.Advancements.Search(msg.Query, msg.Filter, 10)
		if r == nil {
			r = []gamedata.Advancement{}
		}
		results = r
	default:
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "validation", http.StatusBadRequest))
		return
	}

	type response struct {
		Type       string `json:"type"`
		EventID    string `json:"eventID"`
		Collection string `json:"collection"`
		Results    any    `json:"results"`
	}

	b, err := json.Marshal(response{
		Type:       "autocompleteResult",
		EventID:    msg.EventID,
		Collection: msg.Collection,
		Results:    results,
	})
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(
			fmt.Errorf("marshal autocomplete result: %w", err), msg.EventID, "internal",
		))
		return
	}

	hub.ReplyToClient(client, b)
}

type autocompleteApplyMsg struct {
	Type       string `json:"type"`
	EventID    string `json:"eventID"`
	SheetID    string `json:"sheetID"`
	Path       string `json:"path"`
	Collection string `json:"collection"`
	Name       string `json:"name"`
}

func (app *application) autocompleteApplyHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg autocompleteApplyMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal autocompleteApply: %w", err), "", "validation"))
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

	var changesJSON json.RawMessage
	switch msg.Collection {
	case "advancements":
		if app.gamedata == nil || app.gamedata.Advancements == nil {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "not_found", http.StatusNotFound))
			return
		}
		item := app.gamedata.Advancements.GetByName(msg.Name)
		if item == nil {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "not_found", http.StatusNotFound))
			return
		}
		changesJSON = item.ClientJSON()
	default:
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "validation", http.StatusBadRequest))
		return
	}

	version, err := app.models.CharacterSheets.ApplyBatch(ctx, client.userID, sheetID, path, changesJSON)
	if app.wsModelError(hub, client, err, msg.EventID, "autocompleteApply batch") {
		return
	}

	app.infoLog.Printf("autocompleteApply: sheet=%d path=%s collection=%s name=%s", sheetID, msg.Path, msg.Collection, msg.Name)

	type batchBroadcast struct {
		Type    string          `json:"type"`
		EventID string          `json:"eventID"`
		SheetID string          `json:"sheetID"`
		Path    string          `json:"path"`
		Changes json.RawMessage `json:"changes"`
		Version int             `json:"version"`
	}
	broadcast, err := json.Marshal(batchBroadcast{
		Type:    "batch",
		EventID: msg.EventID,
		SheetID: msg.SheetID,
		Path:    msg.Path,
		Changes: changesJSON,
		Version: version,
	})
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal batch broadcast: %w", err), msg.EventID, "internal"))
		return
	}

	hub.BroadcastAll(broadcast)
}
