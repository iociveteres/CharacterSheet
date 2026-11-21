package webapp

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"charactersheet.iociveteres.net/internal/util"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/alehano/reverse"
)

func (app *Application) accountView(w http.ResponseWriter, r *http.Request) {
	app.renderAccount(w, r, http.StatusOK, accountDeleteLinkForm{})
}

// renderAccount draws the Account page; deleteForm carries the error of its deletion block.
func (app *Application) renderAccount(w http.ResponseWriter, r *http.Request, status int, deleteForm accountDeleteLinkForm) {
	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	user, err := app.Models.Users.Get(r.Context(), userID)
	if err != nil {
		if errors.Is(err, models.ErrNoRecord) {
			http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		} else {
			app.serverError(w, err)
		}
		return
	}

	avatar, err := app.accountAvatar(r, user)
	if err != nil {
		app.serverError(w, err)
		return
	}

	data := app.newTemplateData(r)
	data.User = user
	data.Avatar = avatar
	data.Form = deleteForm
	// Laid out for phones, as the forum; crop.css goes before account.css, which sizes the frame.
	data.Head = &templates.PageHead{
		Viewport: true,
		Styles:   []string{"css/crop.css", "css/account.css"},
		Scripts:  []string{"dist/account.js"},
	}

	app.render(w, status, "account.html", "base", data)
}

func (app *Application) accountAvatar(r *http.Request, user *models.User) (*templates.AccountAvatar, error) {
	hashes, err := app.Models.Avatars.Hashes(r.Context(), []int{user.ID})
	if err != nil {
		return nil, err
	}
	lock, err := app.Models.Avatars.LockOf(r.Context(), user.ID)
	if err != nil {
		return nil, err
	}
	a := &templates.AccountAvatar{Lock: lock, Hue: util.AvatarHue(user.ID)}
	if hash, ok := hashes[user.ID]; ok {
		a.URL = avatarURL(hash)
	}
	if first, _ := utf8.DecodeRuneInString(user.Name); first != utf8.RuneError {
		a.Initial = strings.ToUpper(string(first))
	}
	return a, nil
}

type accountPasswordUpdateForm struct {
	CurrentPassword         string `form:"currentPassword"`
	NewPassword             string `form:"newPassword"`
	NewPasswordConfirmation string `form:"newPasswordConfirmation"`
	validator.Validator     `form:"-"`
}

func (app *Application) accountPasswordUpdate(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)
	data.Form = accountPasswordUpdateForm{}
	app.render(w, http.StatusOK, "password.html", "base", data)
}

func (app *Application) accountPasswordUpdatePost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	var form accountPasswordUpdateForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(validator.NotBlank(form.CurrentPassword), "currentPassword", i18n.T(lang, "server.errors.form.blank"))
	form.Check(validator.NotBlank(form.NewPassword), "newPassword", i18n.T(lang, "server.errors.form.blank"))
	form.Check(validator.MinChars(form.NewPassword, 8), "newPassword", i18n.T(lang, "server.errors.form.minChars", i18n.Params{"count": 8}))
	form.Check(validator.NotBlank(form.NewPasswordConfirmation), "newPasswordConfirmation", i18n.T(lang, "server.errors.form.blank"))
	form.Check(form.NewPassword == form.NewPasswordConfirmation, "newPasswordConfirmation", i18n.T(lang, "server.errors.form.passwordsMismatch"))
	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "password.tmpl", "base", data)
		return
	}

	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	err = app.Models.Users.PasswordUpdate(r.Context(), userID, form.CurrentPassword, form.NewPassword)
	if err != nil {
		if errors.Is(err, models.ErrInvalidCredentials) {
			form.AddError("currentPassword", i18n.T(lang, "server.errors.form.currentPasswordIncorrect"))
			data := app.newTemplateData(r)
			data.Form = form
			app.render(w, http.StatusUnprocessableEntity, "password.tmpl", "base", data)
		} else {
			app.serverError(w, err)
		}
		return
	}

	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.passwordUpdated"))
	http.Redirect(w, r, reverse.Rev("AccountView"), http.StatusSeeOther)
}
