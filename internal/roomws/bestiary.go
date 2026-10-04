package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/commands"
)

// The /bestiary page checks a creature with rolls that go to no chat, and
// hears over HTTP of the creatures the user renamed or deleted in another tab.

type rollMsg struct {
	Type          string  `json:"type"`
	EventID       string  `json:"eventID"`
	MessageBody   string  `json:"messageBody"`
	CharacterName *string `json:"characterName,omitempty"`
}

// rollResultMsg is a chat message of the roll (newChatMessageSentMsg) that is
// not stored and has no author.
type rollResultMsg struct {
	Type          string                  `json:"type"`
	EventID       string                  `json:"eventID"`
	MessageBody   string                  `json:"messageBody"`
	CommandResult string                  `json:"commandResult"`
	Versus        *commands.VersusOutcome `json:"versus,omitempty"`
	CharacterName *string                 `json:"characterName,omitempty"`
	CreatedAt     string                  `json:"created"`
}

// rollHandler rolls the command the room would post to the chat and answers
// the sender only.
func (app *Server) rollHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg rollMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("unmarshal roll message: %w", err), "", "validation"))
		return
	}

	r := commands.ParseAndExecuteCommand(msg.MessageBody)
	if r == nil || !r.Success {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "validation", http.StatusBadRequest))
		return
	}

	result, err := json.Marshal(&rollResultMsg{
		Type:          "rollResult",
		EventID:       msg.EventID,
		MessageBody:   msg.MessageBody,
		CommandResult: r.Result,
		Versus:        r.Versus,
		CharacterName: msg.CharacterName,
		CreatedAt:     time.Now().Format(time.RFC3339),
	})
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal rollResult message: %w", err), msg.EventID, "internal"))
		return
	}
	hub.ReplyToClient(client, result)
}

// CreatureRenamed sends the user's /bestiary tabs the new name of their
// creature as an edit of its sheet: a tab that shows it renames it.
func (app *Server) CreatureRenamed(userID, creatureID int, name string) {
	hub := app.bestiaryHub(userID)
	if hub == nil {
		return
	}
	// A string always marshals.
	change, _ := json.Marshal(name)
	msg, err := json.Marshal(&changeMsg{
		Type:    "change",
		SheetID: strconv.Itoa(creatureID),
		Path:    characterNamePath,
		Change:  change,
	})
	if err != nil {
		app.ErrorLog.Printf("creature %d renamed: %v", creatureID, err)
		return
	}
	hub.BroadcastToUser(userID, msg)
}

type creaturesDeletedMsg struct {
	Type string `json:"type"`
	IDs  []int  `json:"ids"`
}

// CreaturesDeleted tells the user's /bestiary tabs that their creatures `ids`
// are gone: a tab lets go of those it shows.
func (app *Server) CreaturesDeleted(userID int, ids []int) {
	hub := app.bestiaryHub(userID)
	if hub == nil || len(ids) == 0 {
		return
	}
	msg, err := json.Marshal(&creaturesDeletedMsg{Type: "creaturesDeleted", IDs: ids})
	if err != nil {
		app.ErrorLog.Printf("creatures %v deleted: %v", ids, err)
		return
	}
	hub.BroadcastToUser(userID, msg)
}
