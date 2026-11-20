package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
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
	// LabelData is the label of a roll from a sheet as data (rolllabel.go),
	// which the body has as ">>" lines too.
	LabelData json.RawMessage `json:"labelData,omitempty"`
}

type newChatMessageSentMsg struct {
	Type          string  `json:"type"`
	EventID       string  `json:"eventID"`
	MessageID     int     `json:"messageId"`
	UserID        int     `json:"userId"`
	UserName      string  `json:"userName"`
	MessageBody   string  `json:"messageBody"`
	CommandResult *string `json:"commandResult,omitempty"`
	// ResultData is CommandResult as data: each viewer renders it in their
	// language, and the sheet that rolled reads its outcome from it.
	ResultData    *commands.ResultData `json:"resultData,omitempty"`
	LabelData     json.RawMessage      `json:"labelData,omitempty"`
	CharacterName *string              `json:"characterName,omitempty"`
	CreatedAt     string               `json:"created"`
}

func (app *Server) chatMessageHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg newChatMessageMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsClientError("", "validation", http.StatusBadRequest))
		return
	}

	var commandResult *string
	var resultData *commands.ResultData
	if strings.HasPrefix(msg.MessageBody, "/") {
		if r := commands.ParseAndExecuteCommand(msg.MessageBody); r.Success {
			commandResult = &r.Result
			resultData = r.Data
		}
	}

	// The label is stored once: as data when it is a label, in the body
	// otherwise, as from a client older than labelData. The command above
	// ran on the whole body, which ignores the ">>" lines.
	body, labelData := msg.MessageBody, json.RawMessage(nil)
	if cut, ok := bodyWithoutLabel(body); ok {
		if labelData = storedLabel(msg.LabelData); labelData != nil {
			body = cut
		}
	}

	app.postChatMessage(ctx, client, hub, msg.EventID, body, commandResult, resultData, labelData, msg.CharacterName)
}

// postChatMessage stores a message of the client in the chat and sends it to
// the whole room, the sender too; false when it replied with an error.
func (app *Server) postChatMessage(ctx context.Context, client *Client, hub *Hub, eventID, body string, commandResult *string, resultData *commands.ResultData, labelData json.RawMessage, characterName *string) bool {
	message, err := app.Models.RoomMessages.CreateWithUsername(ctx, client.userID, hub.roomID, body, commandResult, resultData, labelData, characterName)
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
		ResultData:    message.Message.ResultData,
		LabelData:     message.Message.LabelData,
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
		hub.ReplyToClient(client, app.wsClientError("", "validation", http.StatusBadRequest))
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
