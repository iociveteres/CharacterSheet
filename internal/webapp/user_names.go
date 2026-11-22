package webapp

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"charactersheet.iociveteres.net/internal/util"
	"charactersheet.iociveteres.net/internal/validator"
)

const (
	maxNameChars = 64
	// formerNamesShown is how many former names the Account page and the forum show; the history
	// keeps them all for the export.
	formerNamesShown = 10
)

// checkName is the rule of a name at signup and on a rename (_prd/account_name_email/plan.md, §2):
// trimmed, not blank, at most maxNameChars. It returns the trimmed name, which is what gets
// stored. Whether another account has the name only Insert and Rename can tell: nameTaken.
func checkName(v *validator.Validator, lang, name string) string {
	name = strings.TrimSpace(name)
	v.Check(name != "", "name", i18n.T(lang, "server.errors.form.blank"))
	v.Check(validator.MaxChars(name, maxNameChars), "name", i18n.T(lang, "server.errors.form.maxChars", i18n.Params{"count": maxNameChars}))
	return name
}

// nameTaken is the error of the name field for models.ErrDuplicateName.
func nameTaken(v *validator.Validator, lang string) {
	v.AddError("name", i18n.T(lang, "server.errors.form.nameInUse"))
}

// nameInitial is the first letter of a name, which stands in for a missing avatar.
func nameInitial(name string) string {
	first, _ := utf8.DecodeRuneInString(name)
	if first == utf8.RuneError {
		return ""
	}
	return strings.ToUpper(string(first))
}

// formerNames is the user's last former names as the Account page shows them, dated in the
// viewer's language and time zone.
func (app *Application) formerNames(r *http.Request, userID int) ([]templates.FormerName, error) {
	history, err := app.Models.Users.NameHistory(r.Context(), userID, formerNamesShown)
	if err != nil {
		return nil, err
	}
	lang, loc := i18n.FromContext(r.Context()), util.GetTimeLocation(r)
	names := make([]templates.FormerName, len(history))
	for i, h := range history {
		names[i] = templates.FormerName{Name: h.Name, Date: i18n.FormatDay(lang, h.ChangedAt, loc)}
	}
	return names, nil
}

// renameAnswer is what PUT /account/name answers: the name as stored, the letter of the avatar
// and the former names, with the one just left, or the error of the field.
type renameAnswer struct {
	Name    string                 `json:"name,omitempty"`
	Initial string                 `json:"initial,omitempty"`
	Former  []templates.FormerName `json:"former,omitempty"`
	Errors  map[string]string      `json:"errors,omitempty"`
}

// accountNamePut serves PUT /account/name, the name of the Account page renamed in place
// (ui/static/js/account/Name.tsx).
func (app *Application) accountNamePut(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !app.readJSON(w, r, &req) {
		return
	}
	lang := i18n.FromContext(r.Context())
	userID := app.userID(r)
	var v validator.Validator
	name := checkName(&v, lang, req.Name)
	if v.Valid() {
		err := app.Models.Users.Rename(r.Context(), userID, name)
		switch {
		case errors.Is(err, models.ErrDuplicateName):
			nameTaken(&v, lang)
		case errors.Is(err, models.ErrNoRecord):
			// Signed in, yet not a confirmed account: its deletion was confirmed in another tab.
			app.clientError(w, http.StatusForbidden)
			return
		case err != nil:
			app.serverError(w, err)
			return
		}
	}
	if !v.Valid() {
		app.writeJSON(w, http.StatusUnprocessableEntity, renameAnswer{Errors: v.Errors})
		return
	}
	former, err := app.formerNames(r, userID)
	if err != nil {
		app.serverError(w, err)
		return
	}
	app.writeJSON(w, http.StatusOK, renameAnswer{Name: name, Initial: nameInitial(name), Former: former})
}

// refuseRename answers a rename over renamePerUser with the error under the field.
func (app *Application) refuseRename(w http.ResponseWriter, r *http.Request, wait time.Duration) {
	errs := map[string]string{"name": tooManyAttempts(i18n.FromContext(r.Context()), wait)}
	app.writeJSON(w, http.StatusTooManyRequests, renameAnswer{Errors: errs})
}
