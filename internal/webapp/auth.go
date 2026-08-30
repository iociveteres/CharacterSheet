package webapp

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

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
	var form userSignupForm

	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(validator.NotBlank(form.Name), "name", "This field cannot be blank")
	form.Check(validator.NotBlank(form.Email), "email", "This field cannot be blank")
	form.Check(validator.Matches(form.Email, validator.EmailRX), "email", "This field must be a valid email address")
	form.Check(validator.NotBlank(form.Password), "password", "This field cannot be blank")
	form.Check(validator.MinChars(form.Password, 8), "password", "This field must be at least 8 characters long")

	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "signup.html", "base", data)
		return
	}

	userID, err := app.Models.Users.Insert(r.Context(), form.Name, form.Email, form.Password)
	if err != nil {
		if errors.Is(err, models.ErrDuplicateEmail) {
			form.AddError("email", "Email address is already in use")
			data := app.newTemplateData(r)
			data.Form = form
			app.render(w, http.StatusUnprocessableEntity, "signup.html", "base", data)
		} else {
			app.serverError(w, err)
		}
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

		err := app.Mailer.Send(form.Email, "user_verification.html", data)
		if err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("send verification email to %s: %s", form.Email, err))
		}
	})

	app.SessionManager.Put(r.Context(), "flash", "Your signup was successful. Please verify your email.")
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
		app.SessionManager.Put(r.Context(), "flash", "Activation link is incorrect or expired")
		http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		return
	}

	userID, err := app.Models.Users.ActivateForToken(r.Context(), models.ScopeVerification, token)
	if err != nil {
		switch {
		case errors.Is(err, models.ErrNoRecord):
			app.SessionManager.Put(r.Context(), "flash", "Activation link is incorrect or expired")
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
	app.SessionManager.Put(r.Context(), "flash", "Account successfully activated")

	http.Redirect(w, r, reverse.Rev("AccountRooms"), http.StatusSeeOther)
}

func (app *Application) userResendVerification(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)

	app.render(w, http.StatusOK, "resend_verification.html", "base", data)
}

func (app *Application) userResendVerificationPost(w http.ResponseWriter, r *http.Request) {
	userID := app.SessionManager.GetInt(r.Context(), "resendUserID")
	if userID == 0 {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	app.SessionManager.Remove(r.Context(), "resendUserID")

	err := app.Models.Tokens.DeleteAllForUser(r.Context(), models.ScopeVerification, userID)
	if err != nil {
		app.serverError(w, err)
	}

	app.Models.Tokens.New(r.Context(), userID, 3*24*time.Hour, models.ScopeVerification)

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

		err := app.Mailer.Send(user.Email, "user_verification.html", data)
		if err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("resend verification email to %s: %s", user.Email, err))
		}
	})

	err = app.SessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	app.SessionManager.Put(r.Context(), "flash", "Your verification email has been resent. Check your email.")
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
	var form userPasswordRequesRestForm

	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(validator.NotBlank(form.Email), "email", "This field cannot be blank")
	form.Check(validator.Matches(form.Email, validator.EmailRX), "email", "This field must be a valid email address")

	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "password_request_reset.html", "base", data)
		return
	}

	user, err := app.Models.Users.GetByEmail(r.Context(), form.Email)
	if err != nil {
		// early exit if no such user
		// do not disclose it doesn't exist
		if errors.Is(err, models.ErrNoRecord) {
			app.SessionManager.Put(r.Context(), "flash", "Change password link was sent to provided email")
			http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		} else {
			app.serverError(w, err)
		}
		return
	}

	err = app.Models.Tokens.DeleteAllForUser(r.Context(), models.ScopeChangePassword, user.ID)
	if err != nil {
		app.serverError(w, err)
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

		err := app.Mailer.Send(user.Email, "password_change.html", data)
		if err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("send password reset email to %s: %s", user.Email, err))
		}
	})

	app.SessionManager.Put(r.Context(), "flash", "Change password link was sent to provided email")
	userAuthenticated := app.SessionManager.Exists(r.Context(), "authenticatedUserID")
	if userAuthenticated {
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
	params := httprouter.ParamsFromContext(r.Context())
	changePasswordToken := params.ByName("token")

	exists, err := app.Models.Tokens.CheckExists(r.Context(), models.ScopeChangePassword, changePasswordToken)
	if err != nil {
		app.serverError(w, err)
		return
	}

	if !exists {
		app.SessionManager.Put(r.Context(), "flash", "Change password reset link is incorrect or expired")
		http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		return
	}

	data := app.newTemplateData(r)
	data.Form = accountPasswordResetForm{Token: changePasswordToken}

	app.render(w, http.StatusOK, "password_reset.html", "base", data)
}

func (app *Application) accountPasswordResetPost(w http.ResponseWriter, r *http.Request) {
	var form accountPasswordResetForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	// token field is filled automatically and is hidden
	// ideally change to set flash message
	form.Check(validator.NotBlank(form.Token), "token", "This field cannot be blank")
	form.Check(validator.MinChars(form.NewPassword, 8), "newPassword", "This field must be at least 8 characters long")
	form.Check(validator.NotBlank(form.NewPasswordConfirmation), "newPasswordConfirmation", "This field cannot be blank")
	form.Check(form.NewPassword == form.NewPasswordConfirmation, "newPasswordConfirmation", "Passwords do not match")
	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "password_reset.html", "base", data)
		return
	}

	userID, err := app.Models.Users.PasswordReset(r.Context(), form.Token, form.NewPassword)
	if err != nil {
		switch {
		case errors.Is(err, models.ErrNoRecord):
			app.SessionManager.Put(r.Context(), "flash", "Change password reset link is incorrect or expired")
			http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		default:
			app.serverError(w, err)
		}
		return
	}

	err = app.SessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	app.SessionManager.Put(r.Context(), "authenticatedUserID", userID)
	app.SessionManager.Put(r.Context(), "flash", "Password successfully changed!")

	http.Redirect(w, r, reverse.Rev("AccountRooms"), http.StatusSeeOther)
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
	var form userLoginForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(validator.NotBlank(form.Email), "email", "This field cannot be blank")
	form.Check(validator.Matches(form.Email, validator.EmailRX), "email", "This field must be a valid email address")
	form.Check(validator.NotBlank(form.Password), "password", "This field cannot be blank")
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
			form.AddNonFieldError("Email or password is incorrect")
			data := app.newTemplateData(r)
			data.Form = form
			app.render(w, http.StatusUnprocessableEntity, "login.html", "base", data)
		} else if errors.Is(err, models.ErrUserNotActivated) {
			form.AddNonFieldError("Email is not verified")

			err = app.SessionManager.RenewToken(r.Context())
			if err != nil {
				app.serverError(w, err)
				return
			}
			app.SessionManager.Put(r.Context(), "resendUserID", id)

			http.Redirect(w, r, reverse.Rev("UserResendVerification"), http.StatusSeeOther)
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

	path := app.SessionManager.PopString(r.Context(), "redirectPathAfterLogin")
	if path != "" {
		http.Redirect(w, r, path, http.StatusSeeOther)
		return
	}

	http.Redirect(w, r, reverse.Rev("AccountRooms"), http.StatusSeeOther)
}

func (app *Application) userLogoutPost(w http.ResponseWriter, r *http.Request) {
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
	app.SessionManager.Put(r.Context(), "flash", "You've been logged out successfully!")
	// Redirect the user to the Application home page.
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
