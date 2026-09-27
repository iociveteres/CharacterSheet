package templates

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/models"
)

// The room page embeds its initial state in a script element: it must survive
// any text of the players, carry what the room renders from and nothing more.
func TestRoomStateEmbedsTheRoom(t *testing.T) {
	msk := time.FixedZone("MSK", 3*60*60)
	joined := time.Date(2026, 9, 1, 10, 0, 0, 0, msk)
	folderID := 11
	nasty := `</script><script>alert(1)</script> & "quotes"`
	result := "15"
	data := &Data{
		Room: &models.Room{ID: 5},
		CurrentPlayerView: &models.PlayerView{
			User:     &models.User{ID: 2, Name: "Player", Email: "player@example.com"},
			Role:     models.RolePlayer,
			JoinedAt: joined,
		},
		PlayerViews: []*models.PlayerView{{
			User:     &models.User{ID: 1, Name: nasty, Email: "gm@example.com"},
			Role:     models.RoleGamemaster,
			JoinedAt: joined,
			Folders:  []*models.CharacterSheetFolder{{ID: folderID, Name: "Heroes", Visibility: models.VisibilityHideFromPlayers, SortOrder: 3}},
			CharacterSheets: []*models.CharacterSheet{
				{ID: 7, CharacterName: "Kharn", Kind: models.KindPathfinderCrusade, Visibility: models.VisibilityEveryoneCanView, FolderID: &folderID, CreatedAt: joined, UpdatedAt: joined.Add(time.Hour)},
				{ID: 8, CharacterName: "Lorgar", Kind: models.KindBlackCrusade, Visibility: models.VisibilityEveryoneCanEdit, CreatedAt: joined, UpdatedAt: joined},
			},
		}},
		MessagePage: &models.MessagePage{HasMore: true, Messages: []models.MessageWithName{
			{Message: models.Message{ID: 40, UserID: 1, MessageBody: nasty, CreatedAt: joined}, Username: nasty},
			{Message: models.Message{ID: 41, UserID: 2, MessageBody: "/r d20", CommandResult: &result, CreatedAt: joined.Add(time.Minute)}, Username: "Player"},
		}},
		DicePresets:       []models.DicePreset{{SlotNumber: 3, DiceNotation: "2d10+5"}},
		AvailableCommands: commands.AvailableCommands(),
		InviteLink:        "https://example.com/invite/abc",
		CSRFToken:         "token",
	}

	js, err := roomState(data)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(string(js)), "</script") {
		t.Fatalf("the payload can close its script element: %s", js)
	}
	if strings.Contains(string(js), "@example.com") {
		t.Errorf("the payload carries e-mail addresses: %s", js)
	}

	var state struct {
		RoomID  int `json:"roomId"`
		Players []struct {
			ID       int             `json:"id"`
			Name     string          `json:"name"`
			Role     string          `json:"role"`
			JoinedAt string          `json:"joinedAt"`
			Folders  json.RawMessage `json:"folders"`
			Sheets   []struct {
				ID         int    `json:"id"`
				Name       string `json:"name"`
				Kind       string `json:"kind"`
				Visibility string `json:"visibility"`
				FolderID   *int   `json:"folderId"`
				UpdatedAt  string `json:"updatedAt"`
			} `json:"sheets"`
		} `json:"players"`
		Chat struct {
			Messages []struct {
				ID            int     `json:"id"`
				UserName      string  `json:"userName"`
				MessageBody   string  `json:"messageBody"`
				CommandResult *string `json:"commandResult"`
				CreatedAt     string  `json:"createdAt"`
			} `json:"messages"`
			HasMore bool `json:"hasMore"`
		} `json:"chat"`
		DicePresets []struct {
			Slot     int    `json:"slot"`
			Notation string `json:"notation"`
		} `json:"dicePresets"`
		Commands []struct {
			Command string `json:"command"`
		} `json:"commands"`
		InviteLink string `json:"inviteLink"`
		CSRFToken  string `json:"csrfToken"`
		SheetKinds []struct {
			Kind  string `json:"kind"`
			Label string `json:"label"`
		} `json:"sheetKinds"`
	}
	if err := json.Unmarshal([]byte(js), &state); err != nil {
		t.Fatalf("the payload is not valid JSON: %v: %s", err, js)
	}

	if state.RoomID != 5 || state.InviteLink != data.InviteLink || state.CSRFToken != "token" {
		t.Errorf("roomId, inviteLink, csrfToken = %d, %q, %q", state.RoomID, state.InviteLink, state.CSRFToken)
	}

	if len(state.Players) != 2 || state.Players[0].ID != 2 || state.Players[1].ID != 1 {
		t.Fatalf("players = %+v, want the current user (2) first", state.Players)
	}
	me, gm := state.Players[0], state.Players[1]
	if gm.Name != nasty || gm.Role != "gamemaster" || me.Role != "player" {
		t.Errorf("names and roles = %q %q, %q %q", me.Name, me.Role, gm.Name, gm.Role)
	}
	// A player without folders or sheets has empty lists, not null.
	if string(me.Folders) != "[]" || me.Sheets == nil {
		t.Errorf("folders, sheets of a player without any = %s, %v", me.Folders, me.Sheets)
	}
	if got, err := time.Parse(time.RFC3339, me.JoinedAt); err != nil || !got.Equal(joined) {
		t.Errorf("joinedAt = %q, want %v in RFC 3339", me.JoinedAt, joined)
	}
	if len(gm.Sheets) != 2 {
		t.Fatalf("sheets = %+v", gm.Sheets)
	}
	kharn, lorgar := gm.Sheets[0], gm.Sheets[1]
	if kharn.ID != 7 || kharn.Name != "Kharn" || kharn.Kind != "pathfinder_crusade" || kharn.Visibility != "everyone_can_view" {
		t.Errorf("sheet = %+v", kharn)
	}
	if kharn.FolderID == nil || *kharn.FolderID != folderID || lorgar.FolderID != nil {
		t.Errorf("folderId = %v, %v; want %d and null", kharn.FolderID, lorgar.FolderID, folderID)
	}
	if got, err := time.Parse(time.RFC3339, kharn.UpdatedAt); err != nil || !got.Equal(joined.Add(time.Hour)) {
		t.Errorf("updatedAt = %q", kharn.UpdatedAt)
	}

	msgs := state.Chat.Messages
	if !state.Chat.HasMore || len(msgs) != 2 || msgs[0].ID != 40 || msgs[1].ID != 41 {
		t.Fatalf("chat = %+v, want messages 40 and 41 in order with more to load", state.Chat)
	}
	if msgs[0].MessageBody != nasty || msgs[0].UserName != nasty || msgs[0].CommandResult != nil {
		t.Errorf("message = %+v", msgs[0])
	}
	if msgs[1].CommandResult == nil || *msgs[1].CommandResult != "15" {
		t.Errorf("commandResult = %v, want 15", msgs[1].CommandResult)
	}
	if _, err := time.Parse(time.RFC3339, msgs[1].CreatedAt); err != nil {
		t.Errorf("createdAt = %q: %v", msgs[1].CreatedAt, err)
	}

	if len(state.DicePresets) != 1 || state.DicePresets[0].Slot != 3 || state.DicePresets[0].Notation != "2d10+5" {
		t.Errorf("dicePresets = %+v", state.DicePresets)
	}
	if len(state.Commands) != len(data.AvailableCommands) || state.Commands[0].Command == "" {
		t.Errorf("commands = %+v", state.Commands)
	}
	if len(state.SheetKinds) != len(models.SheetKinds()) || state.SheetKinds[0].Kind != "black_crusade" || state.SheetKinds[0].Label != "Black Crusade" {
		t.Errorf("sheetKinds = %+v", state.SheetKinds)
	}
}
