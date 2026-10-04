package webapp

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"github.com/julienschmidt/httprouter"
)

// encounterPayload is what the gamemaster's client opens an encounter with:
// its state and the sheets of all its participants, which it keeps as sheet
// instances (ui/static/js/room/encounter/).
type encounterPayload struct {
	Encounter *models.EncounterState   `json:"encounter"`
	Sheets    []templates.SheetPayload `json:"sheets"`
}

// encounterView serves GET /encounter/:id to the gamemaster of its room only.
func (app *Application) encounterView(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	id, err := strconv.Atoi(params.ByName("id"))
	if err != nil || id < 1 {
		app.notFound(w)
		return
	}

	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	state, err := app.Models.Encounters.Get(r.Context(), userID, id)
	switch {
	case errors.Is(err, models.ErrNoRecord):
		app.notFound(w)
		return
	case errors.Is(err, models.ErrPermissionDenied):
		app.clientError(w, http.StatusForbidden)
		return
	case err != nil:
		app.serverError(w, err)
		return
	}

	payload := encounterPayload{Encounter: state, Sheets: make([]templates.SheetPayload, 0, len(state.Participants))}
	for _, p := range state.Participants {
		sheet, content, err := app.getCharacterSheetData(r, userID, p.SheetID)
		if err != nil {
			app.serverError(w, err)
			return
		}
		payload.Sheets = append(payload.Sheets, templates.NewSheetPayload(sheet.CharacterSheet, content, sheet.CanEdit))
	}

	body, err := json.Marshal(payload)
	if err != nil {
		app.serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}
