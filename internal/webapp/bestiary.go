package webapp

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"github.com/julienschmidt/httprouter"
)

// The bestiary API of the /bestiary page and the "Add monsters" tab of
// the room: JSON in and out. Another user's collection the user cannot view
// is 404, as a missing one.

const (
	maxBestiaryBody = 1 << 20
	// The uploaded files are taken one by one up to the first that does not
	// fit into the quota, so a request may carry more than the quota.
	maxUploadBody = 64 << 20
)

// bestiaryError answers with the error of the model; true if there was one.
// A quota error carries the text the user reads.
func (app *Application) bestiaryError(w http.ResponseWriter, err error) bool {
	var quota *models.QuotaError
	switch {
	case err == nil:
		return false
	case errors.Is(err, models.ErrNoRecord):
		app.notFound(w)
	case errors.Is(err, models.ErrPermissionDenied):
		app.clientError(w, http.StatusForbidden)
	case errors.Is(err, models.ErrInvalidBestiaryRequest), errors.Is(err, models.ErrInvalidEncounterRequest):
		app.clientError(w, http.StatusBadRequest)
	case errors.As(err, &quota):
		app.writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"code": "quota", "message": quota.Message()})
	default:
		app.serverError(w, err)
	}
	return true
}

func (app *Application) writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		app.serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}

// readJSON decodes the body into dst or answers 400 and returns false.
func (app *Application) readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBestiaryBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		app.clientError(w, http.StatusBadRequest)
		return false
	}
	return true
}

// idParam reads a positive id from the path or answers 404 and returns false.
func (app *Application) idParam(w http.ResponseWriter, r *http.Request) (int, bool) {
	id, err := strconv.Atoi(httprouter.ParamsFromContext(r.Context()).ByName("id"))
	if err != nil || id < 1 {
		app.notFound(w)
		return 0, false
	}
	return id, true
}

func (app *Application) userID(r *http.Request) int {
	return app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
}

func (app *Application) bestiaryPage(w http.ResponseWriter, r *http.Request) {
	app.render(w, http.StatusOK, "bestiary.html", "base", app.newTemplateData(r))
}

func (app *Application) bestiaryGet(w http.ResponseWriter, r *http.Request) {
	b, err := app.Models.Bestiary.Get(r.Context(), app.userID(r))
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusOK, b)
}

func (app *Application) collectionCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !app.readJSON(w, r, &req) {
		return
	}
	c, err := app.Models.Bestiary.CreateCollection(r.Context(), app.userID(r), req.Name)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusCreated, c)
}

func (app *Application) collectionUpdate(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	var edit models.CollectionEdit
	if !app.readJSON(w, r, &edit) {
		return
	}
	c, err := app.Models.Bestiary.UpdateCollection(r.Context(), app.userID(r), id, edit)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusOK, c)
}

// collectionGet is a collection for the middle of the page: the user's own or
// a public one, subscribed to or not.
func (app *Application) collectionGet(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	c, err := app.Models.Bestiary.Collection(r.Context(), app.userID(r), id)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusOK, c)
}

func (app *Application) subscriptionPut(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	c, err := app.Models.Bestiary.Subscribe(r.Context(), app.userID(r), id)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusOK, c)
}

func (app *Application) subscriptionDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	if app.bestiaryError(w, app.Models.Bestiary.Unsubscribe(r.Context(), app.userID(r), id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (app *Application) catalog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter := models.CatalogFilter{Query: q.Get("q")}
	switch q.Get("sort") {
	case "", "new":
	case "old":
		filter.Oldest = true
	default:
		app.clientError(w, http.StatusBadRequest)
		return
	}
	if s := q.Get("after"); s != "" {
		after, err := models.ParseCatalogCursor(s)
		if err != nil {
			app.clientError(w, http.StatusBadRequest)
			return
		}
		filter.After = after
	}
	page, err := app.Models.Bestiary.Catalog(r.Context(), app.userID(r), filter)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusOK, page)
}

func (app *Application) collectionDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	creatures, err := app.Models.Bestiary.DeleteCollection(r.Context(), app.userID(r), id)
	if app.bestiaryError(w, err) {
		return
	}
	app.WSServer.CreaturesDeleted(app.userID(r), creatures)
	w.WriteHeader(http.StatusNoContent)
}

func (app *Application) collectionExport(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	f, err := app.Models.Bestiary.Export(r.Context(), app.userID(r), id)
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

// creaturesOfFile reads an uploaded file: the export of a collection or of
// one sheet.
func creaturesOfFile(data []byte) ([]models.CreatureInFile, error) {
	var head struct {
		Format string `json:"format"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return nil, err
	}
	if head.Format == models.CollectionFileFormat {
		var f models.CollectionFile
		if err := json.Unmarshal(data, &f); err != nil {
			return nil, err
		}
		if f.Version != models.CollectionFileVersion {
			return nil, models.ErrInvalidBestiaryRequest
		}
		return f.Creatures, nil
	}
	content, kind, author, err := sheetOfFile(data)
	if err != nil {
		return nil, err
	}
	return []models.CreatureInFile{{SheetKind: kind, Content: content, Author: author}}, nil
}

// collectionUpload takes the files one by one and stops at the first that
// does not fit into the quota: what came before it stays. A file that is no
// sheet is skipped.
func (app *Application) collectionUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok || !app.readUpload(w, r) {
		return
	}
	defer r.MultipartForm.RemoveAll()

	// No creatures: only whether the collection is the user's, before any file.
	userID := app.userID(r)
	if _, err := app.Models.Bestiary.Upload(r.Context(), userID, id, nil); app.bestiaryError(w, err) {
		return
	}
	results := []models.UploadResult{}
	for _, header := range r.MultipartForm.File["files"] {
		result := models.UploadResult{File: header.Filename}
		data, err := readPart(header)
		if err != nil {
			app.serverError(w, err)
			return
		}
		creatures, err := creaturesOfFile(data)
		if err != nil {
			result.Error = "invalid"
			results = append(results, result)
			continue
		}
		result.Added, err = app.Models.Bestiary.Upload(r.Context(), userID, id, creatures)
		var quota *models.QuotaError
		switch {
		case errors.Is(err, models.ErrInvalidBestiaryRequest):
			result.Error = "invalid"
		case errors.As(err, &quota):
			result.Error, result.Message = "quota", quota.Message()
			results = append(results, result)
			app.writeJSON(w, http.StatusOK, results)
			return
		case app.bestiaryError(w, err):
			return
		}
		results = append(results, result)
	}
	app.writeJSON(w, http.StatusOK, results)
}

func (app *Application) creatureList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter := models.CreatureFilter{Query: q.Get("q")}
	if s := q.Get("collection"); s != "" {
		id, err := strconv.Atoi(s)
		if err != nil || id < 1 {
			app.clientError(w, http.StatusBadRequest)
			return
		}
		filter.CollectionID = &id
	}
	creatures, err := app.Models.Bestiary.Creatures(r.Context(), app.userID(r), filter)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusOK, creatures)
}

func (app *Application) creatureCreate(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	var req struct {
		Kind models.SheetKind `json:"kind"`
	}
	if !app.readJSON(w, r, &req) {
		return
	}
	c, err := app.Models.Bestiary.NewCreature(r.Context(), app.userID(r), id, req.Kind)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusCreated, c)
}

func (app *Application) creatureDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	if app.bestiaryError(w, app.Models.Bestiary.DeleteCreature(r.Context(), app.userID(r), id)) {
		return
	}
	app.WSServer.CreaturesDeleted(app.userID(r), []int{id})
	w.WriteHeader(http.StatusNoContent)
}

func (app *Application) creatureCopy(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	var req models.CollectionTarget
	if !app.readJSON(w, r, &req) {
		return
	}
	c, err := app.Models.Bestiary.CopyCreature(r.Context(), app.userID(r), id, req)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusCreated, c)
}

func (app *Application) creatureMove(w http.ResponseWriter, r *http.Request) {
	id, ok := app.idParam(w, r)
	if !ok {
		return
	}
	var req struct {
		CollectionID int `json:"collectionId"`
	}
	if !app.readJSON(w, r, &req) {
		return
	}
	c, err := app.Models.Bestiary.MoveCreature(r.Context(), app.userID(r), id, req.CollectionID)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusOK, c)
}

func (app *Application) bestiarySave(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SheetID int `json:"sheetId"`
		models.CollectionTarget
	}
	if !app.readJSON(w, r, &req) {
		return
	}
	c, err := app.Models.Bestiary.Save(r.Context(), app.userID(r), req.SheetID, req.CollectionTarget)
	if app.bestiaryError(w, err) {
		return
	}
	app.writeJSON(w, http.StatusCreated, c)
}

func (app *Application) bestiaryAddVariant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SheetID int    `json:"sheetId"`
		Name    string `json:"name"`
	}
	if !app.readJSON(w, r, &req) {
		return
	}
	c, encounterID, err := app.Models.Bestiary.AddVariant(r.Context(), app.userID(r), req.SheetID, req.Name)
	if app.bestiaryError(w, err) {
		return
	}
	// The NPC's source is the variant now: its "Add variant" goes on from it.
	if state, err := app.Models.Encounters.State(r.Context(), encounterID); err != nil {
		app.ErrorLog.Printf("encounter %d after a variant: %v", encounterID, err)
	} else {
		app.WSServer.EncounterChanged(r.Context(), state)
	}
	app.writeJSON(w, http.StatusCreated, c)
}
