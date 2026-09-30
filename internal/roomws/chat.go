package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/models"
)

type newChatMessageMsg struct {
	Type          string  `json:"type"`
	EventID       string  `json:"eventID"`
	MessageBody   string  `json:"messageBody"`
	CharacterName *string `json:"characterName,omitempty"`
}

type newChatMessageSentMsg struct {
	Type          string  `json:"type"`
	EventID       string  `json:"eventID"`
	MessageID     int     `json:"messageId"`
	UserID        int     `json:"userId"`
	UserName      string  `json:"userName"`
	MessageBody   string  `json:"messageBody"`
	CommandResult *string `json:"commandResult,omitempty"`
	// Versus is not stored: only the sheet that rolled reads it, as the
	// message comes back with its eventID.
	Versus        *commands.VersusOutcome `json:"versus,omitempty"`
	CharacterName *string                 `json:"characterName,omitempty"`
	CreatedAt     string                  `json:"created"`
}

func (app *Server) chatMessageHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg newChatMessageMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal chatMessage message: %w", err), "", "validation"))
		return
	}

	var commandResult *string
	var versus *commands.VersusOutcome
	if strings.HasPrefix(msg.MessageBody, "/") {
		if r := commands.ParseAndExecuteCommand(msg.MessageBody); r.Success {
			commandResult = &r.Result
			versus = r.Versus
		}
	}

	app.postChatMessage(ctx, client, hub, msg.EventID, msg.MessageBody, commandResult, msg.CharacterName, versus)
}

// postChatMessage stores a message of the client in the chat and sends it to
// the whole room, the sender too; false when it replied with an error.
func (app *Server) postChatMessage(ctx context.Context, client *Client, hub *Hub, eventID, body string, commandResult, characterName *string, versus *commands.VersusOutcome) bool {
	message, err := app.Models.RoomMessages.CreateWithUsername(ctx, client.userID, hub.roomID, body, commandResult, characterName)
	if app.wsModelError(hub, client, err, eventID, "create chat message") {
		return false
	}

	chatMessageSent := &newChatMessageSentMsg{
		Type:          "chatMessage",
		EventID:       eventID,
		MessageID:     message.Message.ID,
		UserID:        message.Message.UserID,
		UserName:      message.Username,
		MessageBody:   body,
		CommandResult: message.Message.CommandResult,
		Versus:        versus,
		CharacterName: message.Message.CharacterName,
		CreatedAt:     message.Message.CreatedAt.Format(time.RFC3339),
	}

	chatMessageSentJSON, err := json.Marshal(chatMessageSent)
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal chatMessageSent message: %w", err), eventID, "internal"))
		return false
	}

	hub.BroadcastAll(chatMessageSentJSON)
	return true
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

func (app *Server) chatHistoryHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg chatHistoryMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal chatHistory message: %w", err), "", "validation"))
		return
	}

	limit := msg.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	messagePage, err := app.Models.RoomMessages.GetMessagePage(ctx, hub.roomID, msg.Offset, limit)
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
