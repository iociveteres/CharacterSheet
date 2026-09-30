package roomws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/models"
)

// The encounters of the room (_prd/gm_mode). Everything about an encounter
// goes to the gamemaster only; the players get the initiativeView of the
// encounter shown to them. The model checks that the sender is the
// gamemaster of the room of the socket.

// encounterStateMsg is an encounter after a change, to the gamemaster's tabs.
// The eventID is the request's; empty when the server changed it on its own.
type encounterStateMsg struct {
	Type      string                 `json:"type"`
	EventID   string                 `json:"eventID"`
	Encounter *models.EncounterState `json:"encounter"`
}

type encounterListMsg struct {
	Type    string `json:"type"`
	EventID string `json:"eventID"`
	*models.EncounterList
}

// initiativeViewMsg is the turn order every member of the room sees; null
// when no encounter is shown.
type initiativeViewMsg struct {
	Type string                 `json:"type"`
	View *models.InitiativeView `json:"view"`
}

// encounterMsg is what every request about an encounter carries.
type encounterMsg struct {
	EventID     string `json:"eventID"`
	EncounterID int    `json:"encounterId"`
}

// readEncounterMsg reads a request into msg, whose embedded encounterMsg it
// returns, or replies with an error and returns false.
func (app *Server) readEncounterMsg(client *Client, hub *Hub, raw []byte, msg any, base *encounterMsg) bool {
	if err := json.Unmarshal(raw, msg); err != nil {
		hub.ReplyToClient(client, app.wsClientError(base.EventID, "validation", http.StatusBadRequest))
		return false
	}
	return true
}

// encounterError replies with the error of the model; true if there was one.
func (app *Server) encounterError(hub *Hub, client *Client, err error, eventID, context string) bool {
	var quota *models.QuotaError
	switch {
	case err == nil:
		return false
	case errors.Is(err, models.ErrInvalidEncounterRequest), errors.Is(err, models.ErrInvalidInitiativeView):
		hub.ReplyToClient(client, app.wsClientError(eventID, "validation", http.StatusBadRequest))
		return true
	case errors.As(err, &quota):
		resp, _ := json.Marshal(WSResponse{
			Type: "response", EventID: eventID, Code: "quota",
			Message: fmt.Sprintf("The NPCs take %.1f of %.0f MB; this needs %.1f MB more.",
				float64(quota.Used)/(1<<20), float64(quota.Limit)/(1<<20), float64(quota.Adding)/(1<<20)),
		})
		hub.ReplyToClient(client, resp)
		return true
	}
	return app.wsModelError(hub, client, err, eventID, context)
}

// toGamemasters sends msg to every tab of the gamemasters of the room.
func (app *Server) toGamemasters(ctx context.Context, hub *Hub, msg any) {
	gms, err := app.Models.Encounters.Gamemasters(ctx, hub.roomID)
	if err != nil {
		app.ErrorLog.Printf("gamemasters of room %d: %v", hub.roomID, err)
		return
	}
	b, err := json.Marshal(msg)
	if err != nil {
		app.ErrorLog.Printf("marshal %T: %v", msg, err)
		return
	}
	hub.BroadcastToUsers(nil, gms, b)
}

func (app *Server) sendEncounterState(ctx context.Context, hub *Hub, eventID string, state *models.EncounterState) {
	app.toGamemasters(ctx, hub, encounterStateMsg{Type: "encounterState", EventID: eventID, Encounter: state})
}

func (app *Server) sendEncounterList(ctx context.Context, client *Client, hub *Hub, eventID string) {
	list, err := app.Models.Encounters.List(ctx, client.userID, hub.roomID)
	if err != nil {
		app.ErrorLog.Printf("encounters of room %d: %v", hub.roomID, err)
		return
	}
	app.toGamemasters(ctx, hub, encounterListMsg{Type: "encounterList", EventID: eventID, EncounterList: list})
}

func (app *Server) sendInitiativeView(hub *Hub, view *models.InitiativeView) {
	b, err := json.Marshal(initiativeViewMsg{Type: "initiativeView", View: view})
	if err != nil {
		app.ErrorLog.Printf("marshal initiativeView: %v", err)
		return
	}
	hub.BroadcastAll(b)
}

// encounterChange handles a request that changes one encounter and answers
// with its new state.
func (app *Server) encounterChange(ctx context.Context, client *Client, hub *Hub, raw []byte, msg interface{ base() *encounterMsg },
	change func(ref models.EncounterRef) (*models.EncounterState, error)) {
	base := msg.base()
	if !app.readEncounterMsg(client, hub, raw, msg, base) {
		return
	}
	ref := models.EncounterRef{UserID: client.userID, RoomID: hub.roomID, EncounterID: base.EncounterID}
	state, err := change(ref)
	if app.encounterError(hub, client, err, base.EventID, "change encounter") {
		return
	}
	app.sendEncounterState(ctx, hub, base.EventID, state)
}

func (m *encounterMsg) base() *encounterMsg { return m }

type encounterCreateMsg struct {
	encounterMsg
	Name string `json:"name"`
}

func (app *Server) encounterCreateHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterCreateMsg
	if !app.readEncounterMsg(client, hub, raw, &msg, &msg.encounterMsg) {
		return
	}
	state, err := app.Models.Encounters.Create(ctx, client.userID, hub.roomID, msg.Name)
	if app.encounterError(hub, client, err, msg.EventID, "create encounter") {
		return
	}
	app.sendEncounterList(ctx, client, hub, msg.EventID)
	app.sendEncounterState(ctx, hub, msg.EventID, state)
}

func (app *Server) encounterRenameHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterCreateMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		state, err := app.Models.Encounters.Rename(ctx, ref, msg.Name)
		if err == nil {
			app.sendEncounterList(ctx, client, hub, msg.EventID)
		}
		return state, err
	})
}

func (app *Server) encounterDeleteHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterMsg
	if !app.readEncounterMsg(client, hub, raw, &msg, &msg) {
		return
	}
	ref := models.EncounterRef{UserID: client.userID, RoomID: hub.roomID, EncounterID: msg.EncounterID}
	shown, err := app.Models.Encounters.Delete(ctx, ref)
	if app.encounterError(hub, client, err, msg.EventID, "delete encounter") {
		return
	}
	app.sendEncounterList(ctx, client, hub, msg.EventID)
	if shown {
		app.sendInitiativeView(hub, nil)
	}
}

type encounterShowMsg struct {
	EventID string `json:"eventID"`
	// EncounterID null hides the shown one.
	EncounterID *int `json:"encounterId"`
}

func (app *Server) encounterShowHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterShowMsg
	if err := json.Unmarshal(raw, &msg); err != nil {
		hub.ReplyToClient(client, app.wsClientError("", "validation", http.StatusBadRequest))
		return
	}
	view, err := app.Models.Encounters.Show(ctx, client.userID, hub.roomID, msg.EncounterID)
	if app.encounterError(hub, client, err, msg.EventID, "show encounter") {
		return
	}
	app.sendEncounterList(ctx, client, hub, msg.EventID)
	app.sendInitiativeView(hub, view)
	// Its gamemaster sees in its state whether it is shown.
	if msg.EncounterID != nil {
		if state, err := app.Models.Encounters.State(ctx, *msg.EncounterID); err == nil {
			app.sendEncounterState(ctx, hub, msg.EventID, state)
		}
	}
}

type encounterSheetsMsg struct {
	encounterMsg
	SheetIDs []int `json:"sheetIds"`
}

func (app *Server) encounterAddSheetsHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterSheetsMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		return app.Models.Encounters.AddSheets(ctx, ref, msg.SheetIDs)
	})
}

type encounterNewNpcMsg struct {
	encounterMsg
	Kind string `json:"kind"`
}

func (app *Server) encounterNewNpcHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterNewNpcMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		kind, err := models.ParseSheetKind(msg.Kind)
		if err != nil {
			return nil, models.ErrInvalidEncounterRequest
		}
		return app.Models.Encounters.NewNpc(ctx, ref, kind)
	})
}

type encounterDuplicateMsg struct {
	encounterMsg
	ParticipantID int `json:"participantId"`
	Count         int `json:"count"`
}

func (app *Server) encounterDuplicateHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterDuplicateMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		return app.Models.Encounters.Duplicate(ctx, ref, msg.ParticipantID, msg.Count)
	})
}

type encounterParticipantsMsg struct {
	encounterMsg
	ParticipantIDs []int  `json:"participantIds"`
	Name           string `json:"name"`
}

func (app *Server) encounterRemoveHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterParticipantsMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		return app.Models.Encounters.Remove(ctx, ref, msg.ParticipantIDs)
	})
}

func (app *Server) encounterGroupHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterParticipantsMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		return app.Models.Encounters.Group(ctx, ref, msg.ParticipantIDs, msg.Name)
	})
}

type encounterDisplayNameMsg struct {
	encounterMsg
	ParticipantID int    `json:"participantId"`
	Name          string `json:"name"`
}

func (app *Server) encounterSetDisplayNameHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterDisplayNameMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		return app.Models.Encounters.SetDisplayName(ctx, ref, msg.ParticipantID, msg.Name)
	})
}

type encounterUngroupMsg struct {
	encounterMsg
	GroupID int `json:"groupId"`
}

func (app *Server) encounterUngroupHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterUngroupMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		return app.Models.Encounters.Ungroup(ctx, ref, msg.GroupID)
	})
}

type encounterOrderMsg struct {
	encounterMsg
	// Positions of the groups by id, as the client sorted them.
	Positions map[int]int     `json:"positions"`
	View      json.RawMessage `json:"view"`
}

func (app *Server) encounterOrderHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterOrderMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		view, err := models.ParseInitiativeView(msg.View)
		if err != nil {
			return nil, err
		}
		state, err := app.Models.Encounters.Order(ctx, ref, msg.Positions, view)
		if err == nil && state.Shown {
			app.sendInitiativeView(hub, state.InitiativeView)
		}
		return state, err
	})
}

func (app *Server) encounterNextHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		return app.Models.Encounters.Next(ctx, ref)
	})
}

// The initiative of the participants lives in their sheets: the
// gamemaster's client clears it with edits of the sheets.
func (app *Server) encounterResetInitiativeHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterMsg
	app.encounterChange(ctx, client, hub, raw, &msg, func(ref models.EncounterRef) (*models.EncounterState, error) {
		return app.Models.Encounters.ResetInitiative(ctx, ref)
	})
}

const (
	maxInitiativeRolls = 100
	maxRollName        = 100
	maxRollExpression  = 100
)

type initiativeRoll struct {
	SheetID int `json:"sheetId"`
	// Name is the NPC as the players see it.
	Name       string `json:"name"`
	Expression string `json:"expression"`
}

type encounterRollInitiativeMsg struct {
	encounterMsg
	Rolls []initiativeRoll `json:"rolls"`
}

type initiativeTotal struct {
	SheetID int `json:"sheetId"`
	Total   int `json:"total"`
}

type encounterRolledMsg struct {
	Type    string            `json:"type"`
	EventID string            `json:"eventID"`
	Totals  []initiativeTotal `json:"totals"`
}

// encounterRollInitiativeHandler rolls the initiative of NPCs of the
// encounter into one chat message, a line each under the name the players
// see, and answers the sender with the totals, which its client writes into
// the sheets.
func (app *Server) encounterRollInitiativeHandler(ctx context.Context, client *Client, hub *Hub, raw []byte) {
	var msg encounterRollInitiativeMsg
	if !app.readEncounterMsg(client, hub, raw, &msg, &msg.encounterMsg) {
		return
	}
	invalid := len(msg.Rolls) == 0 || len(msg.Rolls) > maxInitiativeRolls
	sheetIDs := make([]int, len(msg.Rolls))
	for i, r := range msg.Rolls {
		sheetIDs[i] = r.SheetID
		invalid = invalid || strings.TrimSpace(r.Name) == "" || utf8.RuneCountInString(r.Name) > maxRollName || len(r.Expression) > maxRollExpression
	}
	if invalid {
		hub.ReplyToClient(client, app.wsClientError(msg.EventID, "validation", http.StatusBadRequest))
		return
	}
	ref := models.EncounterRef{UserID: client.userID, RoomID: hub.roomID, EncounterID: msg.EncounterID}
	if app.encounterError(hub, client, app.Models.Encounters.CheckNpcs(ctx, ref, sheetIDs), msg.EventID, "check NPCs") {
		return
	}

	lines := make([]string, len(msg.Rolls))
	totals := make([]initiativeTotal, len(msg.Rolls))
	for i, r := range msg.Rolls {
		total, err := commands.RollTotal(r.Expression)
		if err != nil {
			hub.ReplyToClient(client, app.wsClientError(msg.EventID, "validation", http.StatusBadRequest))
			return
		}
		lines[i] = fmt.Sprintf("%s: %s = %d", strings.TrimSpace(r.Name), strings.ReplaceAll(r.Expression, " ", ""), total)
		totals[i] = initiativeTotal{SheetID: r.SheetID, Total: total}
	}

	result := strings.Join(lines, "\n")
	if !app.postChatMessage(ctx, client, hub, msg.EventID, "Initiative", &result, nil, nil) {
		return
	}
	reply, err := json.Marshal(encounterRolledMsg{Type: "encounterRolled", EventID: msg.EventID, Totals: totals})
	if err != nil {
		hub.ReplyToClient(client, app.wsServerError(fmt.Errorf("marshal encounterRolled: %w", err), msg.EventID, "internal"))
		return
	}
	hub.ReplyToClient(client, reply)
}

// encountersLeft sends the gamemaster the encounters a deleted sheet of the
// room was taken out of.
func (app *Server) encountersLeft(ctx context.Context, hub *Hub, encounterIDs []int) {
	for _, id := range encounterIDs {
		state, err := app.Models.Encounters.State(ctx, id)
		if err != nil {
			app.ErrorLog.Printf("encounter %d: %v", id, err)
			continue
		}
		app.sendEncounterState(ctx, hub, "", state)
	}
}
