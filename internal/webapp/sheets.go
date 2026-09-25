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

	// The room page renders the sheet from this (ui/static/js/sheet/main.ts).
	payload := templates.NewSheetPayload(sheetView.CharacterSheet, characterSheetContent, sheetView.CanEdit)
	body, err := json.Marshal(payload)
	if err != nil {
		app.serverError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

// sheetKindJSONField carries the sheet kind in exported files, it is not part
// of the stored content.
const sheetKindJSONField = "sheetKind"

// contentWithSheetKind returns the sheet content with the kind added, for export.
func contentWithSheetKind(content json.RawMessage, kind models.SheetKind) ([]byte, error) {
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(content, &fields); err != nil {
		return nil, err
	}

	encodedKind, err := json.Marshal(string(kind))
	if err != nil {
		return nil, err
	}
	fields[sheetKindJSONField] = encodedKind

	return json.Marshal(fields)
}

// contentWithoutSheetKind splits an imported file into the content to store and
// the kind it declares. A file without the field is of the default kind.
func contentWithoutSheetKind(content []byte) ([]byte, models.SheetKind, error) {
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(content, &fields); err != nil {
		return nil, "", err
	}

	raw, ok := fields[sheetKindJSONField]
	if !ok {
		return content, models.DefaultSheetKind, nil
	}

	var declared string
	if err := json.Unmarshal(raw, &declared); err != nil {
		return nil, "", err
	}

	kind, err := models.ParseSheetKind(declared)
	if err != nil {
		return nil, "", err
	}

	delete(fields, sheetKindJSONField)
	stripped, err := json.Marshal(fields)
	if err != nil {
		return nil, "", err
	}

	return stripped, kind, nil
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
		return
	}

	exported, err := contentWithSheetKind(sheetView.CharacterSheet.Content, sheetView.CharacterSheet.Kind)
	if err != nil {
		app.serverError(w, err)
		return
	}

	// Pretty-print JSON with indentation
	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, exported, "", "  "); err != nil {
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

	content, kind, err := contentWithoutSheetKind(content)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	// validate it's valid character sheet
	if err := models.ValidateCharacterSheetJSON(content); err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	// Create new character sheet with imported content
	sheetID, err := app.Models.CharacterSheets.InsertWithContent(r.Context(), userID, roomID, kind, json.RawMessage(content))
	if err != nil {
		app.serverError(w, err)
		return
	}

	hub := app.WSServer.GetOrInitHub(roomID)
	app.WSServer.ImportedCharacterSheetHandler(r.Context(), hub, sheetID)
}
