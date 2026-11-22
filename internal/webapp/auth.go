package webapp

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/alehano/reverse"
	"github.com/julienschmidt/httprouter"
)

type userSignupForm struct {
	Name                string `form:"name"`
	Email               string `form:"email"`
	Password            string `form:"password"`
	validator.Validator `form:"-"`
}

func (app *Application) userSignup(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)
	data.Form = userSignupForm{}
	app.render(w, http.StatusOK, "signup.html", "base", data)
}

func (app *Application) userSignupPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	var form userSignupForm

	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Name = checkName(&form.Validator, lang, form.Name)
	form.Check(validator.NotBlank(form.Email), "email", i18n.T(lang, "server.errors.form.blank"))
	form.Check(validator.Matches(form.Email, validator.EmailRX), "email", i18n.T(lang, "server.errors.form.email"))
	form.Check(validator.NotBlank(form.Password), "password", i18n.T(lang, "server.errors.form.blank"))
	form.Check(validator.MinChars(form.Password, 8), "password", i18n.T(lang, "server.errors.form.minChars", i18n.Params{"count": 8}))

	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "signup.html", "base", data)
		return
	}

	userID, err := app.Models.Users.Insert(r.Context(), form.Name, form.Email, form.Password, lang)
	if err != nil {
		switch {
		case errors.Is(err, models.ErrDuplicateEmail):
			form.AddError("email", i18n.T(lang, "server.errors.form.emailInUse"))
		case errors.Is(err, models.ErrDuplicateName):
			nameTaken(&form.Validator, lang)
		default:
			app.serverError(w, err)
			return
		}
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "signup.html", "base", data)
		return
	}

	token, err := app.Models.Tokens.New(r.Context(), userID, 3*24*time.Hour, models.ScopeVerification)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.background(func() {
		data := map[string]any{
			"ActivationLink": app.BaseURL + reverse.Rev("UserVerify", token.Plaintext),
			"Name":           form.Name,
		}

		err := app.Mailer.Send(form.Email, lang, "user_verification", data)
		if err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("send verification email to %s: %s", form.Email, err))
		}
	})

	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.signedUp"))
	http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
}

func (app *Application) userVerify(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	verificationToken := params.ByName("token")

	data := app.newTemplateData(r)
	data.Token = verificationToken

	app.render(w, http.StatusOK, "verify_user.html", "base", data)
}

func (app *Application) userVerifyPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	var token string
	// it's single button form with no validation required
	// hence why simpler way to parse form is used
	if err := r.ParseForm(); err == nil {
		if v := strings.TrimSpace(r.PostFormValue("token")); v != "" {
			token = v
		}
	}

	if token == "" {
		params := httprouter.ParamsFromContext(r.Context())
		if v := strings.TrimSpace(params.ByName("token")); v != "" {
			token = v
		}
	}

	if token == "" {
		app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.activationLinkInvalid"))
		http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		return
	}

	userID, err := app.Models.Users.ActivateForToken(r.Context(), models.ScopeVerification, token)
	if err != nil {
		switch {
		case errors.Is(err, models.ErrNoRecord):
			app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.activationLinkInvalid"))
			http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		default:
			app.serverError(w, err)
		}
		return
	}

	// after
	err = app.SessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	app.SessionManager.Put(r.Context(), "authenticatedUserID", userID)
	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.activated"))

	http.Redirect(w, r, reverse.Rev("AccountRooms"), http.StatusSeeOther)
}

// resendVerificationForm is a button only; the form carries an error when the
// resend is refused.
type resendVerificationForm struct {
	validator.Validator `form:"-"`
}

func (app *Application) userResendVerification(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)
	data.Form = resendVerificationForm{}

	app.render(w, http.StatusOK, "resend_verification.html", "base", data)
}

func (app *Application) userResendVerificationPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	userID := app.SessionManager.GetInt(r.Context(), "resendUserID")
	if userID == 0 {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	app.SessionManager.Remove(r.Context(), "resendUserID")

	err := app.Models.Tokens.DeleteAllForUser(r.Context(), models.ScopeVerification, userID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	token, err := app.Models.Tokens.New(r.Context(), userID, 3*24*time.Hour, models.ScopeVerification)
	if err != nil {
		app.serverError(w, err)
		return
	}

	user, err := app.Models.Users.Get(r.Context(), userID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.background(func() {
		data := map[string]any{
			"ActivationLink": app.BaseURL + reverse.Rev("UserVerify", token.Plaintext),
			"Name":           user.Name,
		}

		err := app.Mailer.Send(user.Email, mailLanguage(r, user), "user_verification", data)
		if err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("resend verification email to %s: %s", user.Email, err))
		}
	})

	err = app.SessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.verificationResent"))
	http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
}

type userPasswordRequesRestForm struct {
	Email               string `form:"email"`
	validator.Validator `form:"-"`
}

func (app *Application) userPasswordRequestReset(w http.ResponseWriter, r *http.Request) {
	var email string
	userAuthenticated := app.SessionManager.Exists(r.Context(), "authenticatedUserID")
	if userAuthenticated {
		userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
		user, err := app.Models.Users.Get(r.Context(), userID)
		// if no error, user is authed and found, prefill email
		if err == nil {
			email = user.Email
		}
	}

	data := app.newTemplateData(r)
	data.Form = userPasswordRequesRestForm{Email: email}

	app.render(w, http.StatusOK, "password_request_reset.html", "base", data)
}

func (app *Application) userPasswordRequestResetPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	var form userPasswordRequesRestForm

	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(validator.NotBlank(form.Email), "email", i18n.T(lang, "server.errors.form.blank"))
	form.Check(validator.Matches(form.Email, validator.EmailRX), "email", i18n.T(lang, "server.errors.form.email"))

	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "password_request_reset.html", "base", data)
		return
	}

	user, err := app.Models.Users.GetByEmail(r.Context(), form.Email)
	if err != nil {
		// No such user: answered as if the link went out, so the page does
		// not tell which emails have an account.
		if errors.Is(err, models.ErrNoRecord) {
			app.passwordResetRequested(w, r)
		} else {
			app.serverError(w, err)
		}
		return
	}

	err = app.Models.Tokens.DeleteAllForUser(r.Context(), models.ScopeChangePassword, user.ID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	token, err := app.Models.Tokens.New(r.Context(), user.ID, 4*time.Hour, models.ScopeChangePassword)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.background(func() {
		data := map[string]any{
			"ResetPasswordLink": app.BaseURL + reverse.Rev("PasswordReset", token.Plaintext),
			"Name":              user.Name,
		}

		err := app.Mailer.Send(user.Email, mailLanguage(r, user), "password_change", data)
		if err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("send password reset email to %s: %s", user.Email, err))
		}
	})

	app.passwordResetRequested(w, r)
}

func (app *Application) passwordResetRequested(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.passwordLinkSent"))
	if app.SessionManager.Exists(r.Context(), "authenticatedUserID") {
		http.Redirect(w, r, reverse.Rev("AccountView"), http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
}

type accountPasswordResetForm struct {
	Token                   string `form:"token"`
	NewPassword             string `form:"newPassword"`
	NewPasswordConfirmation string `form:"newPasswordConfirmation"`
	validator.Validator     `form:"-"`
}

func (app *Application) accountPasswordReset(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	params := httprouter.ParamsFromContext(r.Context())
	changePasswordToken := params.ByName("token")

	exists, err := app.Models.Tokens.CheckExists(r.Context(), models.ScopeChangePassword, changePasswordToken)
	if err != nil {
		app.serverError(w, err)
		return
	}

	if !exists {
		app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.passwordLinkInvalid"))
		http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		return
	}

	data := app.newTemplateData(r)
	data.Form = accountPasswordResetForm{Token: changePasswordToken}

	app.render(w, http.StatusOK, "password_reset.html", "base", data)
}

func (app *Application) accountPasswordResetPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	var form accountPasswordResetForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	// token field is filled automatically and is hidden
	// ideally change to set flash message
	form.Check(validator.NotBlank(form.Token), "token", i18n.T(lang, "server.errors.form.blank"))
	form.Check(validator.MinChars(form.NewPassword, 8), "newPassword", i18n.T(lang, "server.errors.form.minChars", i18n.Params{"count": 8}))
	form.Check(validator.NotBlank(form.NewPasswordConfirmation), "newPasswordConfirmation", i18n.T(lang, "server.errors.form.blank"))
	form.Check(form.NewPassword == form.NewPasswordConfirmation, "newPasswordConfirmation", i18n.T(lang, "server.errors.form.passwordsMismatch"))
	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "password_reset.html", "base", data)
		return
	}

	userID, err := app.Models.Users.PasswordReset(r.Context(), form.Token, form.NewPassword)
	if errors.Is(err, models.ErrNoRecord) {
		app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.passwordLinkInvalid"))
		http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		return
	}
	if err != nil && !errors.Is(err, models.ErrDeletionScheduled) && !errors.Is(err, models.ErrUserNotActivated) {
		app.serverError(w, err)
		return
	}

	if err := app.SessionManager.RenewToken(r.Context()); err != nil {
		app.serverError(w, err)
		return
	}
	// The password is changed whatever the status; only a confirmed account signs in, the others
	// get the page a login with the new password would bring them to.
	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.passwordReset"))
	switch {
	case errors.Is(err, models.ErrDeletionScheduled):
		app.SessionManager.Put(r.Context(), deletionPendingKey, userID)
		http.Redirect(w, r, reverse.Rev("AccountDeletion"), http.StatusSeeOther)
	case errors.Is(err, models.ErrUserNotActivated):
		app.SessionManager.Put(r.Context(), "resendUserID", userID)
		http.Redirect(w, r, reverse.Rev("UserResendVerification"), http.StatusSeeOther)
	default:
		app.SessionManager.Remove(r.Context(), deletionPendingKey)
		app.SessionManager.Put(r.Context(), "authenticatedUserID", userID)
		http.Redirect(w, r, reverse.Rev("AccountRooms"), http.StatusSeeOther)
	}
}

type userLoginForm struct {
	Email               string `form:"email"`
	Password            string `form:"password"`
	validator.Validator `form:"-"`
}

func (app *Application) userLogin(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)
	data.Form = userLoginForm{}
	app.render(w, http.StatusOK, "login.html", "base", data)
}

func (app *Application) userLoginPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	var form userLoginForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(validator.NotBlank(form.Email), "email", i18n.T(lang, "server.errors.form.blank"))
	form.Check(validator.Matches(form.Email, validator.EmailRX), "email", i18n.T(lang, "server.errors.form.email"))
	form.Check(validator.NotBlank(form.Password), "password", i18n.T(lang, "server.errors.form.blank"))
	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "login.html", "base", data)
		return
	}
	// Check whether the credentials are valid. If they're not, add a generic
	// non-field error message and re-display the login page.
	id, err := app.Models.Users.Authenticate(r.Context(), form.Email, form.Password)
	if err != nil {
		if errors.Is(err, models.ErrInvalidCredentials) {
			form.AddNonFieldError(i18n.T(lang, "server.errors.form.credentialsIncorrect"))
			data := app.newTemplateData(r)
			data.Form = form
			app.render(w, http.StatusUnprocessableEntity, "login.html", "base", data)
		} else if errors.Is(err, models.ErrUserNotActivated) {
			form.AddNonFieldError(i18n.T(lang, "server.errors.form.emailNotVerified"))

			err = app.SessionManager.RenewToken(r.Context())
			if err != nil {
				app.serverError(w, err)
				return
			}
			app.SessionManager.Put(r.Context(), "resendUserID", id)

			http.Redirect(w, r, reverse.Rev("UserResendVerification"), http.StatusSeeOther)
		} else if errors.Is(err, models.ErrDeletionScheduled) {
			// The right password of an account in its grace period: the grace page, not a
			// sign-in (plan _prd/account_deletion, section 5.1, step 4).
			err = app.SessionManager.RenewToken(r.Context())
			if err != nil {
				app.serverError(w, err)
				return
			}
			app.SessionManager.Remove(r.Context(), "authenticatedUserID")
			app.SessionManager.Put(r.Context(), deletionPendingKey, id)
			http.Redirect(w, r, reverse.Rev("AccountDeletion"), http.StatusSeeOther)
		} else {
			app.serverError(w, err)
		}
		return
	}
	// Use the RenewToken() method on the current session to change the session ID.
	// It's good practice to generate a new session ID when the authentication
	// state or privilege levels changes for the user (e.g. login and logout operations).
	err = app.SessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	// Add the ID of the current user to the session, so that they are now
	// 'logged in'.
	app.SessionManager.Put(r.Context(), "authenticatedUserID", id)
	app.SessionManager.Remove(r.Context(), deletionPendingKey)

	path := app.SessionManager.PopString(r.Context(), "redirectPathAfterLogin")
	if path != "" {
		http.Redirect(w, r, path, http.StatusSeeOther)
		return
	}

	http.Redirect(w, r, reverse.Rev("AccountRooms"), http.StatusSeeOther)
}

func (app *Application) userLogoutPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	// Use the RenewToken() method on the current session to change the session ID.
	err := app.SessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	// Remove the authenticatedUserID from the session data so that the user is
	// 'logged out'.
	app.SessionManager.Remove(r.Context(), "authenticatedUserID")
	// Add a flash message to the session to confirm to the user that they've been
	// logged out.
	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "server.errors.flash.loggedOut"))
	// Redirect the user to the Application home page.
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// mailLanguage is the language of an email to user: the account's, or for an account without
// one (made before languages) the language of the request, which its owner most likely sent.
func mailLanguage(r *http.Request, user *models.User) string {
	if i18n.Supported(user.Locale) {
		return user.Locale
	}
	return i18n.FromContext(r.Context())
}
