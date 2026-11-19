package webapp

import (
	"errors"
	"net/http"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/alehano/reverse"
)

func (app *Application) accountView(w http.ResponseWriter, r *http.Request) {
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

	data := app.newTemplateData(r)
	data.User = user

	app.render(w, http.StatusOK, "account.html", "base", data)
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
