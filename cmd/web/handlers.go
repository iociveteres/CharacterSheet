package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/alehano/reverse"
	"github.com/google/uuid"
	"github.com/julienschmidt/httprouter"
)

func ping(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("OK"))
}

func (app *application) home(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)

	app.render(w, http.StatusOK, "home.html", "base", data)
}

type userSignupForm struct {
	Name                string `form:"name"`
	Email               string `form:"email"`
	Password            string `form:"password"`
	validator.Validator `form:"-"`
}

func (app *application) userSignup(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)
	data.Form = userSignupForm{}
	app.render(w, http.StatusOK, "signup.html", "base", data)
}

func (app *application) userSignupPost(w http.ResponseWriter, r *http.Request) {
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

	userID, err := app.models.Users.Insert(r.Context(), form.Name, form.Email, form.Password)
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

	token, err := app.models.Tokens.New(userID, 3*24*time.Hour, models.ScopeVerification)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.background(func() {
		data := map[string]any{
			"ActivationLink": app.baseURL + reverse.Rev("UserVerify", token.Plaintext),
			"Name":           form.Name,
		}

		err = app.mailer.Send(form.Email, "user_verification.html", data)
		if err != nil {
			app.serverError(w, err)
		}
	})

	app.sessionManager.Put(r.Context(), "flash", "Your signup was successful. Please verify your email.")
	http.Redirect(w, r, "/user/login", http.StatusSeeOther)
}

func (app *application) userVerify(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	verificationToken := params.ByName("token")

	data := app.newTemplateData(r)
	data.Token = verificationToken

	app.render(w, http.StatusOK, "verify_user.html", "base", data)
}

func (app *application) userVerifyPost(w http.ResponseWriter, r *http.Request) {
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
		app.sessionManager.Put(r.Context(), "flash", "Activation link is incorrect or expired")
		http.Redirect(w, r, "/user/login", http.StatusSeeOther)
		return
	}

	userID, err := app.models.Users.ActivateForToken(r.Context(), models.ScopeVerification, token)
	if err != nil {
		switch {
		case errors.Is(err, models.ErrNoRecord):
			app.sessionManager.Put(r.Context(), "flash", "Activation link is incorrect or expired")
			http.Redirect(w, r, "/user/login", http.StatusSeeOther)
		default:
			app.serverError(w, err)
		}
		return
	}

	// after
	err = app.sessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	app.sessionManager.Put(r.Context(), "authenticatedUserID", userID)
	app.sessionManager.Put(r.Context(), "flash", "Account successfully activated")

	http.Redirect(w, r, "/account/rooms", http.StatusSeeOther)
}

func (app *application) userResendVerification(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)

	app.render(w, http.StatusOK, "resend_verification.html", "base", data)
}

func (app *application) userResendVerificationPost(w http.ResponseWriter, r *http.Request) {
	userID := app.sessionManager.GetInt(r.Context(), "resendUserID")
	if userID == 0 {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	app.sessionManager.Remove(r.Context(), "resendUserID")

	err := app.models.Tokens.DeleteAllForUser(models.ScopeVerification, userID)
	if err != nil {
		app.serverError(w, err)
	}

	app.models.Tokens.New(userID, 3*24*time.Hour, models.ScopeVerification)

	token, err := app.models.Tokens.New(userID, 3*24*time.Hour, models.ScopeVerification)
	if err != nil {
		app.serverError(w, err)
		return
	}

	user, err := app.models.Users.Get(r.Context(), userID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.background(func() {
		data := map[string]any{
			"ActivationLink": app.baseURL + reverse.Rev("UserVerify", token.Plaintext),
			"Name":           user.Name,
		}

		err = app.mailer.Send(user.Email, "user_verification.html", data)
		if err != nil {
			app.serverError(w, err)
		}
	})

	err = app.sessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	app.sessionManager.Put(r.Context(), "flash", "Your verification email has been resent. Check your email.")
	http.Redirect(w, r, "/user/login", http.StatusSeeOther)
}

type userLoginForm struct {
	Email               string `form:"email"`
	Password            string `form:"password"`
	validator.Validator `form:"-"`
}

func (app *application) userLogin(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)
	data.Form = userLoginForm{}
	app.render(w, http.StatusOK, "login.html", "base", data)
}

func (app *application) userLoginPost(w http.ResponseWriter, r *http.Request) {
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
	id, err := app.models.Users.Authenticate(r.Context(), form.Email, form.Password)
	if err != nil {
		if errors.Is(err, models.ErrInvalidCredentials) {
			form.AddNonFieldError("Email or password is incorrect")
			data := app.newTemplateData(r)
			data.Form = form
			app.render(w, http.StatusUnprocessableEntity, "login.html", "base", data)
		} else if errors.Is(err, models.ErrUserNotActivated) {
			form.AddNonFieldError("Email is not verified")

			err = app.sessionManager.RenewToken(r.Context())
			if err != nil {
				app.serverError(w, err)
				return
			}
			app.sessionManager.Put(r.Context(), "resendUserID", id)

			http.Redirect(w, r, reverse.Rev("UserResendVerification"), http.StatusSeeOther)
		} else {
			app.serverError(w, err)
		}
		return
	}
	// Use the RenewToken() method on the current session to change the session ID.
	// It's good practice to generate a new session ID when the authentication
	// state or privilege levels changes for the user (e.g. login and logout operations).
	err = app.sessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	// Add the ID of the current user to the session, so that they are now
	// 'logged in'.
	app.sessionManager.Put(r.Context(), "authenticatedUserID", id)

	path := app.sessionManager.PopString(r.Context(), "redirectPathAfterLogin")
	if path != "" {
		http.Redirect(w, r, path, http.StatusSeeOther)
		return
	}

	http.Redirect(w, r, "/account/rooms", http.StatusSeeOther)
}

func (app *application) userLogoutPost(w http.ResponseWriter, r *http.Request) {
	// Use the RenewToken() method on the current session to change the session ID.
	err := app.sessionManager.RenewToken(r.Context())
	if err != nil {
		app.serverError(w, err)
		return
	}
	// Remove the authenticatedUserID from the session data so that the user is
	// 'logged out'.
	app.sessionManager.Remove(r.Context(), "authenticatedUserID")
	// Add a flash message to the session to confirm to the user that they've been
	// logged out.
	app.sessionManager.Put(r.Context(), "flash", "You've been logged out successfully!")
	// Redirect the user to the application home page.
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (app *application) accountView(w http.ResponseWriter, r *http.Request) {
	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	user, err := app.models.Users.Get(r.Context(), userID)
	if err != nil {
		if errors.Is(err, models.ErrNoRecord) {
			http.Redirect(w, r, "/user/login", http.StatusSeeOther)
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

func (app *application) accountPasswordUpdate(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)
	data.Form = accountPasswordUpdateForm{}
	app.render(w, http.StatusOK, "password.html", "base", data)
}

func (app *application) accountPasswordUpdatePost(w http.ResponseWriter, r *http.Request) {
	var form accountPasswordUpdateForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(validator.NotBlank(form.CurrentPassword), "currentPassword", "This field cannot be blank")
	form.Check(validator.NotBlank(form.NewPassword), "newPassword", "This field cannot be blank")
	form.Check(validator.MinChars(form.NewPassword, 8), "newPassword", "This field must be at least 8 characters long")
	form.Check(validator.NotBlank(form.NewPasswordConfirmation), "newPasswordConfirmation", "This field cannot be blank")
	form.Check(form.NewPassword == form.NewPasswordConfirmation, "newPasswordConfirmation", "Passwords do not match")
	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "password.tmpl", "base", data)
		return
	}

	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	err = app.models.Users.PasswordUpdate(r.Context(), userID, form.CurrentPassword, form.NewPassword)
	if err != nil {
		if errors.Is(err, models.ErrInvalidCredentials) {
			form.AddError("currentPassword", "Current password is incorrect")
			data := app.newTemplateData(r)
			data.Form = form
			app.render(w, http.StatusUnprocessableEntity, "password.tmpl", "base", data)
		} else {
			app.serverError(w, err)
		}
		return
	}

	app.sessionManager.Put(r.Context(), "flash", "Your password has been updated!")
	http.Redirect(w, r, "/account/view", http.StatusSeeOther)
}

func (app *application) accountRooms(w http.ResponseWriter, r *http.Request) {
	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	rooms, err := app.models.Rooms.ByUser(r.Context(), userID)
	if err != nil {
		if errors.Is(err, models.ErrNoRecord) {
			http.Redirect(w, r, "/user/login", http.StatusSeeOther)
		} else {
			app.serverError(w, err)
		}
		return
	}

	data := app.newTemplateData(r)
	data.Rooms = rooms
	app.render(w, http.StatusOK, "rooms.html", "base", data)
}

type roomCreateForm struct {
	Name                string `form:"name"`
	validator.Validator `form:"-"`
}

func (app *application) roomCreate(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)

	data.Form = roomCreateForm{}

	app.render(w, http.StatusOK, "create_room.html", "base", data)
}

func (app *application) roomCreatePost(w http.ResponseWriter, r *http.Request) {
	var form roomCreateForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(validator.NotBlank(form.Name), "name", "This field cannot be blank")

	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "create_room.html", "base", data)
		return
	}

	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	id, err := app.models.Rooms.Create(r.Context(), userID, form.Name)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.sessionManager.Put(r.Context(), "flash", "Room successfully created!")

	http.Redirect(w, r, fmt.Sprintf("/room/view/%d", id), http.StatusSeeOther)
}

func (app *application) roomView(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())

	roomID, err := strconv.Atoi(params.ByName("id"))
	if err != nil || roomID < 1 {
		app.notFound(w)
		return
	}

	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	isInRoom, err := app.models.Rooms.HasUser(r.Context(), roomID, userID)
	if err != nil || !isInRoom {
		// TODO: Change to custom "you have no access to this room or it does not exist"
		app.notFound(w)
		return
	}

	room, err := app.models.Rooms.Get(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	players, err := app.models.Rooms.PlayersWithSheets(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	current, others := extractPlayerByUserID(players, userID)

	roomInvite, err := app.models.RoomInvites.GetInvite(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	data := app.newTemplateData(r)
	data.PlayerViews = others
	data.CurrentPlayerView = current
	data.Room = room
	if roomInvite != nil {
		inviteLink := makeInviteLink(roomInvite.Token, app.baseURL)
		data.RoomInvite = roomInvite
		data.InviteLink = inviteLink
	}
	data.HideLayout = true

	app.GetOrInitHub(roomID)

	app.render(w, http.StatusOK, "view_room.html", "base", data)
}

func (app *application) accountSheets(w http.ResponseWriter, r *http.Request) {
	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	characterSheetsSummuries, err := app.models.CharacterSheets.SummaryByUser(r.Context(), userID)
	if err != nil {
		if errors.Is(err, models.ErrNoRecord) {
			http.Redirect(w, r, "/user/login", http.StatusSeeOther)
		} else {
			app.serverError(w, err)
		}
		return
	}

	data := app.newTemplateData(r)
	data.CharacterSheetSummaries = characterSheetsSummuries
	app.render(w, http.StatusOK, "character_sheets.html", "base", data)
}

func (app *application) sheetShow(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)
	data.HideLayout = true

	app.render(w, http.StatusOK, "charactersheet_template.html", "base", data)
}

func (app *application) sheetView(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	sheetID, err := strconv.Atoi(params.ByName("id"))
	if err != nil || sheetID < 1 {
		app.notFound(w)
		return
	}

	// Get userID from session
	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")

	sheetView, err := app.models.CharacterSheets.GetWithPermission(r.Context(), userID, sheetID)
	if err != nil {
		if err == models.ErrNoRecord {
			app.notFound(w)
			return
		}
		app.serverError(w, err)
		return
	}

	characterSheetContent, err := sheetView.CharacterSheet.UnmarshalContent()
	if err != nil {
		app.serverError(w, err)
		return
	}

	data := &templateData{
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

func (app *application) roomViewWithSheet(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())

	roomID, err := strconv.Atoi(params.ByName("roomid"))
	if err != nil || roomID < 1 {
		app.notFound(w)
		return
	}
	sheetID, err := strconv.Atoi(params.ByName("sheetid"))
	if err != nil || sheetID < 1 {
		app.notFound(w)
		return
	}

	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	isInRoom, err := app.models.Rooms.HasUser(r.Context(), roomID, userID)
	if err != nil || !isInRoom {
		app.notFound(w)
		return
	}

	room, err := app.models.Rooms.Get(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	players, err := app.models.Rooms.PlayersWithSheets(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	current, others := extractPlayerByUserID(players, userID)

	roomInvite, err := app.models.RoomInvites.GetInvite(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	characterSheet, err := app.models.CharacterSheets.Get(r.Context(), sheetID)
	if err != nil {
		if err == models.ErrNoRecord {
			app.notFound(w)
			return
		}
		app.serverError(w, err)
		return
	}

	characterSheetContent, err := characterSheet.UnmarshalContent()
	if err != nil {
		app.serverError(w, err)
		return
	}

	data := app.newTemplateData(r)
	data.PlayerViews = others
	data.CurrentPlayerView = current
	data.Room = room
	if roomInvite != nil {
		inviteLink := makeInviteLink(roomInvite.Token, app.baseURL)
		data.RoomInvite = roomInvite
		data.InviteLink = inviteLink
	}
	data.HideLayout = true

	data.CharacterSheetContent = characterSheetContent
	data.CharacterSheet = characterSheet

	app.GetOrInitHub(roomID)

	app.render(w, http.StatusOK, "view_room.html", "base", data)
}

func (app *application) redeemInvite(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	token, err := uuid.Parse(params.ByName("token"))
	if err != nil {
		// app.serverError(w, err)
		app.clientError(w, http.StatusNotFound)
		return
	}

	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")

	roomID, _, err := app.models.RoomInvites.TryEnterRoom(r.Context(), token, userID, models.RolePlayer)
	if err != nil {
		if errors.Is(err, models.ErrLinkInvalid) {
			app.clientError(w, http.StatusNotFound)
			return
		}
		app.serverError(w, err)
		return
	}

	user, err := app.models.Users.Get(r.Context(), userID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.newPlayerHandler(app.hubMap[roomID], userID, user.Name, user.CreatedAt)

	http.Redirect(w, r, "/room/view/"+strconv.Itoa(roomID), http.StatusSeeOther)
}

func (app *application) sheetExport(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	sheetID, err := strconv.Atoi(params.ByName("id"))
	if err != nil {
		app.serverError(w, err)
		return
	}

	sheet, err := app.models.CharacterSheets.Get(r.Context(), sheetID)
	if err != nil {
		if errors.Is(err, models.ErrNoRecord) {
			app.notFound(w)
		} else {
			app.serverError(w, err)
		}
		return
	}

	// Pretty-print JSON with indentation
	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, sheet.Content, "", "  "); err != nil {
		app.serverError(w, err)
		return
	}

	filename := fmt.Sprintf("character_%s.json", sheet.CharacterName)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))

	w.Write(prettyJSON.Bytes())
}

func (app *application) sheetImport(w http.ResponseWriter, r *http.Request) {
	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")

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
	sheetID, err := app.models.CharacterSheets.InsertWithContent(r.Context(), userID, roomID, json.RawMessage(content))
	if err != nil {
		app.serverError(w, err)
		return
	}

	hub := app.GetOrInitHub(roomID)
	app.importedCharacterSheetHandler(r.Context(), hub, sheetID)
}
