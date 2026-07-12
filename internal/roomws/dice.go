package roomws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

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

func (app *Server) updateDicePresetHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
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

	if err := app.Models.RoomDicePresets.Upsert(ctx, client.userID, hub.roomID, msg.SlotNumber, notation); err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("upsert dice preset: %w", err), msg.EventID, "internal"))
		return
	}

	app.InfoLog.Printf("dice preset updated user=%d room=%d slot=%d", client.userID, hub.roomID, msg.SlotNumber)

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
