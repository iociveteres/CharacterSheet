package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/util"
	"github.com/google/uuid"
)

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

func (app *Server) newInviteLinkHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg newInviteLinkMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsClientError("", "validation", http.StatusBadRequest))
		return
	}

	var expiresAt *time.Time
	if msg.ExpiresInDays != nil {
		if *msg.ExpiresInDays < 0 {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "validation", http.StatusBadRequest))
			return
		}
		t := time.Now().Add(time.Duration(*msg.ExpiresInDays) * 24 * time.Hour)
		expiresAt = &t
	}

	if msg.MaxUses != nil {
		if *msg.MaxUses < 0 {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "validation", http.StatusBadRequest))
			return
		}
		if *msg.MaxUses == 0 {
			msg.MaxUses = nil
		}
	}

	newRoomInvite, err := app.Models.RoomInvites.CreateOrReplaceInvite(ctx, hub.roomID, expiresAt, msg.MaxUses)
	if app.wsModelError(hub, client, err, msg.EventID, "create invite link") {
		return
	}

	newInviteLinkCreated := &newInviteLinkCreatedMsg{
		Type:      "newInviteLink",
		EventID:   msg.EventID,
		Link:      util.MakeInviteLink(newRoomInvite.Token, app.BaseURL),
		CreatedAt: newRoomInvite.CreatedAt,
		ExpiresAt: newRoomInvite.ExpiresAt,
		MaxUses:   newRoomInvite.MaxUses,
	}

	newInviteLinkCreatedJSON, err := json.Marshal(newInviteLinkCreated)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal newInviteLink created message: %w", err), msg.EventID, "internal"))
		return
	}

	app.InfoLog.Printf("invite link created for room %d", hub.roomID)
	hub.ReplyToClient(client, newInviteLinkCreatedJSON)
}

type newPlayerMsg struct {
	Type     string    `json:"type"`
	EventID  string    `json:"eventID"`
	UserID   int       `json:"userID"`
	Name     string    `json:"name"`
	JoinedAt time.Time `json:"joined"`
}

func (app *Server) NewPlayerHandler(hub *Hub, userID int, name string, joinedAt time.Time) {
	newPlayer := &newPlayerMsg{
		Type:     "newPlayer",
		EventID:  uuid.New().String(),
		UserID:   userID,
		Name:     name,
		JoinedAt: joinedAt,
	}

	newPlayerJSON, err := json.Marshal(newPlayer)
	if err != nil {
		app.ErrorLog.Print(err)
		return
	}

	hub.BroadcastAll(newPlayerJSON)
}

type kickPlayerMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	UserID  int    `json:"userID"`
}

func (app *Server) kickPlayerHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg kickPlayerMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsClientError("", "validation", http.StatusBadRequest))
		return
	}

	err := app.Models.RoomMembers.Remove(ctx, client.userID, hub.roomID, msg.UserID)
	if app.wsModelError(hub, client, err, msg.EventID, "kick player") {
		return
	}

	hub.BroadcastAll(raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, -1))

	// Delay gives the client time to receive the broadcast before being disconnected.
	go func() {
		defer func() {
			if v := recover(); v != nil {
				logPanic(app.ErrorLog, v, fmt.Sprintf("kick of user %d from room %d", msg.UserID, hub.roomID))
			}
		}()
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

func (app *Server) changePlayerRoleHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg ChangePlayerRoleMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsClientError("", "validation", http.StatusBadRequest))
		return
	}

	err := app.Models.RoomMembers.ChangeRole(ctx, client.userID, hub.roomID, msg.UserID, msg.Role)
	if app.wsModelError(hub, client, err, msg.EventID, "change player role") {
		return
	}

	hub.BroadcastFrom(client, raw)
	hub.ReplyToClient(client, app.wsOK(msg.EventID, -1))
}

type playerDeletedMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	UserID  int    `json:"userID"`
	// Who got the user's sheets and folders in the room, 0 for nobody.
	HeirID          int  `json:"heirID"`
	MessagesDeleted bool `json:"messagesDeleted"`
}

// PlayerDeleted tells the open pages of the rooms that stay after the wipe of an account (plan
// _prd/account_deletion, section 5.2): the player goes, their sheets and folders go to the heir,
// their chat messages go if they chose so, and whoever became a gamemaster is told as by a role
// change. A room no one has open has no one to tell.
func (app *Server) PlayerDeleted(userID int, rooms []models.WipedRoom) {
	for _, room := range rooms {
		hub := app.RoomHub(room.RoomID)
		if hub == nil {
			continue
		}
		deleted, err := json.Marshal(&playerDeletedMsg{
			Type:            "playerDeleted",
			EventID:         uuid.New().String(),
			UserID:          userID,
			HeirID:          room.HeirID,
			MessagesDeleted: room.MessagesDeleted,
		})
		if err != nil {
			app.ErrorLog.Print(err)
			return
		}
		hub.BroadcastAll(deleted)
		if room.PromotedID == 0 {
			continue
		}
		promoted, err := json.Marshal(&ChangePlayerRoleMsg{
			Type:    "changePlayerRole",
			EventID: uuid.New().String(),
			UserID:  room.PromotedID,
			Role:    models.RoleGamemaster,
		})
		if err != nil {
			app.ErrorLog.Print(err)
			return
		}
		hub.BroadcastAll(promoted)
	}
}
