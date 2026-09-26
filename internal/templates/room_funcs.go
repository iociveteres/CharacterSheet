package templates

import (
	"encoding/json"
	"html/template"
	"time"

	"charactersheet.iociveteres.net/internal/models"
)

// RoomPayload is what the client renders the room page from: the #room-state
// script (ui/static/js/room/store.js). Dates are RFC 3339; the client formats
// them in the browser's time zone.
type RoomPayload struct {
	RoomID int `json:"roomId"`
	// Players has the current user first.
	Players     []RoomPlayer     `json:"players"`
	Chat        RoomChat         `json:"chat"`
	DicePresets []RoomDicePreset `json:"dicePresets"`
	Commands    []RoomCommand    `json:"commands"`
	InviteLink  string           `json:"inviteLink"`
	// CSRFToken goes with the sheet import form (POST /sheet/import).
	CSRFToken  string          `json:"csrfToken"`
	SheetKinds []RoomSheetKind `json:"sheetKinds"`
}

type RoomPlayer struct {
	ID       int             `json:"id"`
	Name     string          `json:"name"`
	Role     models.RoomRole `json:"role"`
	JoinedAt time.Time       `json:"joinedAt"`
	Folders  []RoomFolder    `json:"folders"`
	Sheets   []RoomSheet     `json:"sheets"`
}

type RoomFolder struct {
	ID         int                    `json:"id"`
	Name       string                 `json:"name"`
	Visibility models.SheetVisibility `json:"visibility"`
	SortOrder  int                    `json:"sortOrder"`
}

type RoomSheet struct {
	ID         int                    `json:"id"`
	Name       string                 `json:"name"`
	Kind       models.SheetKind       `json:"kind"`
	Visibility models.SheetVisibility `json:"visibility"`
	FolderID   *int                   `json:"folderId" tstype:"number | null,required"`
	CreatedAt  time.Time              `json:"createdAt"`
	UpdatedAt  time.Time              `json:"updatedAt"`
}

// RoomChat is the newest page of the chat, oldest message first.
type RoomChat struct {
	Messages []ChatMessage `json:"messages"`
	HasMore  bool          `json:"hasMore"`
}

type ChatMessage struct {
	ID            int       `json:"id"`
	UserID        int       `json:"userId"`
	UserName      string    `json:"userName"`
	MessageBody   string    `json:"messageBody"`
	CommandResult *string   `json:"commandResult" tstype:"string | null,required"`
	CharacterName *string   `json:"characterName" tstype:"string | null,required"`
	CreatedAt     time.Time `json:"createdAt"`
}

type RoomDicePreset struct {
	Slot     int    `json:"slot"`
	Notation string `json:"notation"`
}

type RoomCommand struct {
	Command             string `json:"command"`
	Description         string `json:"description"`
	DetailedDescription string `json:"detailedDescription"`
}

type RoomSheetKind struct {
	Kind  models.SheetKind `json:"kind"`
	Label string           `json:"label"`
}

func NewRoomPayload(data *Data) RoomPayload {
	payload := RoomPayload{
		RoomID:      data.Room.ID,
		Players:     make([]RoomPlayer, 0, 1+len(data.PlayerViews)),
		Chat:        RoomChat{Messages: make([]ChatMessage, 0, len(data.MessagePage.Messages)), HasMore: data.MessagePage.HasMore},
		DicePresets: make([]RoomDicePreset, 0, len(data.DicePresets)),
		Commands:    make([]RoomCommand, 0, len(data.AvailableCommands)),
		InviteLink:  data.InviteLink,
		CSRFToken:   data.CSRFToken,
		SheetKinds:  make([]RoomSheetKind, 0, len(models.SheetKinds())),
	}

	for _, p := range append([]*models.PlayerView{data.CurrentPlayerView}, data.PlayerViews...) {
		player := RoomPlayer{
			ID:       p.User.ID,
			Name:     p.User.Name,
			Role:     p.Role,
			JoinedAt: p.JoinedAt,
			Folders:  make([]RoomFolder, 0, len(p.Folders)),
			Sheets:   make([]RoomSheet, 0, len(p.CharacterSheets)),
		}
		for _, f := range p.Folders {
			player.Folders = append(player.Folders, RoomFolder{ID: f.ID, Name: f.Name, Visibility: f.Visibility, SortOrder: f.SortOrder})
		}
		for _, s := range p.CharacterSheets {
			player.Sheets = append(player.Sheets, RoomSheet{
				ID:         s.ID,
				Name:       s.CharacterName,
				Kind:       s.Kind,
				Visibility: s.Visibility,
				FolderID:   s.FolderID,
				CreatedAt:  s.CreatedAt,
				UpdatedAt:  s.UpdatedAt,
			})
		}
		payload.Players = append(payload.Players, player)
	}

	for _, m := range data.MessagePage.Messages {
		payload.Chat.Messages = append(payload.Chat.Messages, ChatMessage{
			ID:            m.Message.ID,
			UserID:        m.Message.UserID,
			UserName:      m.Username,
			MessageBody:   m.Message.MessageBody,
			CommandResult: m.Message.CommandResult,
			CharacterName: m.Message.CharacterName,
			CreatedAt:     m.Message.CreatedAt,
		})
	}

	for _, p := range data.DicePresets {
		payload.DicePresets = append(payload.DicePresets, RoomDicePreset{Slot: p.SlotNumber, Notation: p.DiceNotation})
	}

	for _, c := range data.AvailableCommands {
		payload.Commands = append(payload.Commands, RoomCommand{Command: c.Command, Description: c.Description, DetailedDescription: c.DetailedDescription})
	}

	for _, k := range models.SheetKinds() {
		payload.SheetKinds = append(payload.SheetKinds, RoomSheetKind{Kind: k.Kind, Label: k.Label})
	}

	return payload
}

// roomState serializes the room of the page for the #room-state script.
// json.Marshal escapes <, > and &, so the output cannot close the script
// element.
func roomState(data *Data) (template.JS, error) {
	jsonData, err := json.Marshal(NewRoomPayload(data))
	if err != nil {
		return "", err
	}
	return template.JS(jsonData), nil
}
