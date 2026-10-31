package roomws

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/google/uuid"
)

type portraitChangedMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	SheetID string `json:"sheetID"`
	// Portrait is the hash of the new portrait, nil once it is deleted.
	Portrait *string `json:"portrait"`
}

// PortraitChanged tells everyone who sees the sheet of its new portrait, the
// user who changed it too: the HTTP request that changed it answers with no
// hash, so all tabs take it from here. The edits of a creature go to the
// bestiary tabs of its collection's owner, as its field edits do.
func (app *Server) PortraitChanged(ctx context.Context, sheetID int, portrait *string) {
	audience, err := app.Models.CharacterSheets.Audience(ctx, sheetID)
	if err != nil {
		app.ErrorLog.Printf("portrait of sheet %d changed: %v", sheetID, err)
		return
	}
	msg, err := json.Marshal(&portraitChangedMsg{
		Type:     "portraitChanged",
		EventID:  uuid.New().String(),
		SheetID:  strconv.Itoa(sheetID),
		Portrait: portrait,
	})
	if err != nil {
		app.ErrorLog.Printf("portrait of sheet %d changed: %v", sheetID, err)
		return
	}

	if audience.CollectionOwnerID != 0 {
		if hub := app.bestiaryHub(audience.CollectionOwnerID); hub != nil {
			hub.BroadcastToUser(audience.CollectionOwnerID, msg)
		}
		return
	}
	if audience.RoomID != 0 {
		app.GetOrInitHub(audience.RoomID).BroadcastToUsers(nil, audience.Viewers, msg)
	}
}
