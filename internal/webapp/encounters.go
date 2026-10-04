package webapp

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"time"

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

// The file of an encounter (models.EncounterFile): its gamemaster exports it,
// loads files as new encounters of the room or puts the NPCs of one in place
// of those of an encounter. The room hears of the change from here
// (roomws.Server.EncountersLoaded and the like).

func (app *Application) encounterExport(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	f, err := app.Models.Encounters.Export(r.Context(), app.userID(r), id)
	if app.bestiaryError(w, err) {
		return
	}
	body, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		app.serverError(w, err)
		return
	}
	filename := fmt.Sprintf("%s_%s.json", f.Name, time.Now().Format("2006-01-02_15-04-05"))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Write(body)
}

// readUpload reads the multipart form of an upload of files, or answers 400
// and returns false; the caller removes the form's files.
func (app *Application) readUpload(w http.ResponseWriter, r *http.Request) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBody)
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		app.clientError(w, http.StatusBadRequest)
		return false
	}
	return true
}

func readPart(header *multipart.FileHeader) ([]byte, error) {
	f, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

// encountersLoad makes a new encounter of each file, one by one, and stops at
// the first that does not fit into the quota: what came before it stays. A
// file that is no encounter is skipped.
func (app *Application) encountersLoad(w http.ResponseWriter, r *http.Request) {
	if !app.readUpload(w, r) {
		return
	}
	defer r.MultipartForm.RemoveAll()
	roomID, err := strconv.Atoi(r.FormValue("room_id"))
	if err != nil || roomID < 1 {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	// Only the gamemaster of the room, before any file.
	userID := app.userID(r)
	if _, err := app.Models.Encounters.List(r.Context(), userID, roomID); app.bestiaryError(w, err) {
		return
	}

	results := []models.EncounterLoadResult{}
	loaded := false
	defer func() {
		if loaded {
			app.WSServer.EncountersLoaded(r.Context(), roomID, userID)
		}
	}()
	for _, header := range r.MultipartForm.File["files"] {
		result := models.EncounterLoadResult{File: header.Filename}
		data, err := readPart(header)
		if err != nil {
			app.serverError(w, err)
			return
		}
		f, err := models.ParseEncounterFile(data)
		if err != nil {
			result.Error = "invalid"
			results = append(results, result)
			continue
		}
		state, err := app.Models.Encounters.Load(r.Context(), userID, roomID, f)
		var quota *models.QuotaError
		switch {
		case errors.As(err, &quota):
			result.Error, result.Message = "quota", quota.Message()
			results = append(results, result)
			app.writeJSON(w, http.StatusOK, results)
			return
		case app.bestiaryError(w, err):
			return
		}
		loaded = true
		result.EncounterID, result.Name, result.Npcs = state.ID, state.Name, len(state.Participants)
		results = append(results, result)
	}
	app.writeJSON(w, http.StatusOK, results)
}

// encounterReplaceNpcs puts the NPCs of the file in place of those of the
// encounter.
func (app *Application) encounterReplaceNpcs(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok || !app.readUpload(w, r) {
		return
	}
	defer r.MultipartForm.RemoveAll()
	userID := app.userID(r)
	// The room of the encounter, which only its gamemaster reads.
	state, err := app.Models.Encounters.Get(r.Context(), userID, id)
	if app.bestiaryError(w, err) {
		return
	}
	headers := r.MultipartForm.File["file"]
	if len(headers) != 1 {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	data, err := readPart(headers[0])
	if err != nil {
		app.serverError(w, err)
		return
	}
	f, err := models.ParseEncounterFile(data)
	if app.bestiaryError(w, err) {
		return
	}
	ref := models.EncounterRef{UserID: userID, RoomID: state.RoomID, EncounterID: id}
	state, err = app.Models.Encounters.ReplaceNpcs(r.Context(), ref, f)
	if app.bestiaryError(w, err) {
		return
	}
	app.WSServer.EncounterNpcsReplaced(r.Context(), state)
	app.writeJSON(w, http.StatusOK, state)
}
