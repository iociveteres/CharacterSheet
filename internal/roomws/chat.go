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
	CharacterName *string `json:"characterName,omitempty"`
	CreatedAt     string  `json:"created"`
}

func (app *Server) chatMessageHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	message, err := app.Models.RoomMessages.CreateWithUsername(ctx, client.userID, hub.roomID, msg.MessageBody, commandResult, msg.CharacterName)
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
		CharacterName: message.Message.CharacterName,
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
