package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"charactersheet.iociveteres.net/internal/models"
)

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

func (app *Server) createFolderHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	folder, err := app.Models.CharacterSheetFolders.Create(ctx, client.userID, hub.roomID, msg.Name, visibility)
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

	app.InfoLog.Printf("Folder created: id=%d owner=%d room=%d", folder.ID, client.userID, hub.roomID)
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

func (app *Server) updateFolderHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	err := app.Models.CharacterSheetFolders.Update(ctx, client.userID, msg.FolderID, msg.Name, visibility)
	if app.wsModelError(hub, client, err, msg.EventID, "update folder") {
		return
	}

	app.InfoLog.Printf("Folder updated: id=%d user=%d", msg.FolderID, client.userID)
	hub.BroadcastAll(raw)
}

type deleteFolderMsg struct {
	Type     string `json:"type"`
	EventID  string `json:"eventID"`
	FolderID int    `json:"folderId"`
}

func (app *Server) deleteFolderHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg deleteFolderMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal deleteFolder message: %w", err), "", "validation"))
		return
	}

	err := app.Models.CharacterSheetFolders.Delete(ctx, client.userID, msg.FolderID)
	if app.wsModelError(hub, client, err, msg.EventID, "delete folder") {
		return
	}

	app.InfoLog.Printf("Folder deleted: id=%d user=%d", msg.FolderID, client.userID)
	hub.BroadcastAll(raw)
}

type reorderFoldersMsg struct {
	Type      string `json:"type"`
	EventID   string `json:"eventID"`
	FolderIDs []int  `json:"folderIds"`
}

func (app *Server) reorderFoldersHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg reorderFoldersMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal reorderFolders message: %w", err), "", "validation"))
		return
	}

	err := app.Models.CharacterSheetFolders.Reorder(ctx, client.userID, hub.roomID, msg.FolderIDs)
	if app.wsModelError(hub, client, err, msg.EventID, "reorder folders") {
		return
	}

	app.InfoLog.Printf("Folders reordered: user=%d room=%d", client.userID, hub.roomID)
	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, -1))
}

type moveSheetToFolderMsg struct {
	Type     string `json:"type"`
	EventID  string `json:"eventID"`
	SheetID  int    `json:"sheetId"`
	FolderID *int   `json:"folderId"`
}

func (app *Server) moveSheetToFolderHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg moveSheetToFolderMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal moveSheetToFolder message: %w", err), "", "validation"))
		return
	}

	err := app.Models.CharacterSheetFolders.MoveSheetToFolder(ctx, client.userID, msg.SheetID, msg.FolderID)
	if app.wsModelError(hub, client, err, msg.EventID, "move sheet to folder") {
		return
	}

	app.InfoLog.Printf("Sheet moved to folder: sheet=%d folder=%v user=%d", msg.SheetID, msg.FolderID, client.userID)
	hub.BroadcastAll(raw)
}
