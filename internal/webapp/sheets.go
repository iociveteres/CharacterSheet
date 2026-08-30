package webapp

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"github.com/alehano/reverse"
	"github.com/julienschmidt/httprouter"
)

func (app *Application) accountSheets(w http.ResponseWriter, r *http.Request) {
	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	characterSheetsSummuries, err := app.Models.CharacterSheets.SummaryByUser(r.Context(), userID)
	if err != nil {
		if errors.Is(err, models.ErrNoRecord) {
			http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		} else {
			app.serverError(w, err)
		}
		return
	}

	data := app.newTemplateData(r)
	data.CharacterSheetSummaries = characterSheetsSummuries
	app.render(w, http.StatusOK, "character_sheets.html", "base", data)
}

func (app *Application) sheetShow(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)
	data.HideLayout = true

	app.render(w, http.StatusOK, "charactersheet_template.html", "base", data)
}

func (app *Application) getCharacterSheetData(r *http.Request, userID, sheetID int) (*models.CharacterSheetView, *models.CharacterSheetContent, error) {
	sheetView, err := app.Models.CharacterSheets.GetWithPermission(r.Context(), userID, sheetID)
	if err != nil {
		return nil, nil, err
	}
	characterSheetContent, err := sheetView.CharacterSheet.UnmarshalContent()
	if err != nil {
		return nil, nil, err
	}
	return sheetView, characterSheetContent, nil
}

func (app *Application) sheetView(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	sheetID, err := strconv.Atoi(params.ByName("id"))
	if err != nil || sheetID < 1 {
		app.notFound(w)
		return
	}

	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	sheetView, characterSheetContent, err := app.getCharacterSheetData(r, userID, sheetID)
	if err != nil {
		switch err {
		case models.ErrNoRecord:
			app.notFound(w)
		case models.ErrPermissionDenied:
			app.clientError(w, http.StatusForbidden)
		default:
			app.serverError(w, err)
		}
		return
	}

	data := &templates.Data{
		CharacterSheetContent: characterSheetContent,
		CharacterSheet:        sheetView.CharacterSheet,
		CanEditSheet:          sheetView.CanEdit,
	}

	// determine if this should be a fragment (AJAX) response
	isAjax := r.Header.Get("X-Requested-With") == "XMLHttpRequest" || r.URL.Query().Get("partial") == "1"
	if isAjax {
		// render only the fragment template (no base layout)
		// page is the key in templateCache used when parsing; tplName is the define'd template to execute.
		// Example: when templates parsed include {{define "sheet_fragment"}} ... {{end}}
		app.render(w, http.StatusOK, "charactersheet_template.html", "character_sheet_fragment", data)
		return
	}
}

func (app *Application) sheetExport(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	sheetID, err := strconv.Atoi(params.ByName("id"))
	if err != nil {
		app.serverError(w, err)
		return
	}

	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	sheetView, err := app.Models.CharacterSheets.GetWithPermission(r.Context(), userID, sheetID)
	if err != nil {
		switch err {
		case models.ErrNoRecord:
			app.SessionManager.Put(r.Context(), "flash", "The specified character sheet was deleted or did not exist")
			app.notFound(w)
		case models.ErrPermissionDenied:
			app.clientError(w, http.StatusForbidden)
		default:
			app.serverError(w, err)
		}
	}

	// Pretty-print JSON with indentation
	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, sheetView.CharacterSheet.Content, "", "  "); err != nil {
		app.serverError(w, err)
		return
	}

	filename := fmt.Sprintf("%s_%s.json", sheetView.CharacterSheet.CharacterName, time.Now().Format("2006-01-02_15-04-05"))
	w.Header().Set("Content-Type", "Application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))

	w.Write(prettyJSON.Bytes())
}

func (app *Application) sheetImport(w http.ResponseWriter, r *http.Request) {
	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")

	// Parse multipart form (10MB max)
	err := r.ParseMultipartForm(10 << 20)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	roomID, err := strconv.Atoi(r.FormValue("room_id"))
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	isMember, err := app.Models.Rooms.HasUser(r.Context(), roomID, userID)
	if err != nil || !isMember {
		app.clientError(w, http.StatusForbidden)
		return
	}

	file, _, err := r.FormFile("sheet_file")
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Read the JSON content
	content, err := io.ReadAll(file)
	if err != nil {
		app.serverError(w, err)
		return
	}

	// Validate it's valid JSON
	if !json.Valid(content) {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	// validate it's valid character sheet
	if err := models.ValidateCharacterSheetJSON(content); err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	// Create new character sheet with imported content
	sheetID, err := app.Models.CharacterSheets.InsertWithContent(r.Context(), userID, roomID, json.RawMessage(content))
	if err != nil {
		app.serverError(w, err)
		return
	}

	hub := app.WSServer.GetOrInitHub(roomID)
	app.WSServer.ImportedCharacterSheetHandler(r.Context(), hub, sheetID)
}
