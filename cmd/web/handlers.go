package main

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/validator"
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

	form.CheckField(validator.NotBlank(form.Name), "name", "This field cannot be blank")
	form.CheckField(validator.NotBlank(form.Email), "email", "This field cannot be blank")
	form.CheckField(validator.Matches(form.Email, validator.EmailRX), "email", "This field must be a valid email address")
	form.CheckField(validator.NotBlank(form.Password), "password", "This field cannot be blank")
	form.CheckField(validator.MinChars(form.Password, 8), "password", "This field must be at least 8 characters long")

	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "signup.html", "base", data)
		return
	}

	err = app.users.Insert(r.Context(), form.Name, form.Email, form.Password)
	if err != nil {
		if errors.Is(err, models.ErrDuplicateEmail) {
			form.AddFieldError("email", "Email address is already in use")
			data := app.newTemplateData(r)
			data.Form = form
			app.render(w, http.StatusUnprocessableEntity, "signup.html", "base", data)
		} else {
			app.serverError(w, err)
		}
		return
	}

	app.sessionManager.Put(r.Context(), "flash", "Your signup was successful. Please log in.")
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

	form.CheckField(validator.NotBlank(form.Email), "email", "This field cannot be blank")
	form.CheckField(validator.Matches(form.Email, validator.EmailRX), "email", "This field must be a valid email address")
	form.CheckField(validator.NotBlank(form.Password), "password", "This field cannot be blank")
	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "login.html", "base", data)
		return
	}
	// Check whether the credentials are valid. If they're not, add a generic
	// non-field error message and re-display the login page.
	id, err := app.users.Authenticate(r.Context(), form.Email, form.Password)
	if err != nil {
		if errors.Is(err, models.ErrInvalidCredentials) {
			form.AddNonFieldError("Email or password is incorrect")
			data := app.newTemplateData(r)
			data.Form = form
			app.render(w, http.StatusUnprocessableEntity, "login.html", "base", data)
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
	user, err := app.users.Get(r.Context(), userID)
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

	form.CheckField(validator.NotBlank(form.CurrentPassword), "currentPassword", "This field cannot be blank")
	form.CheckField(validator.NotBlank(form.NewPassword), "newPassword", "This field cannot be blank")
	form.CheckField(validator.MinChars(form.NewPassword, 8), "newPassword", "This field must be at least 8 characters long")
	form.CheckField(validator.NotBlank(form.NewPasswordConfirmation), "newPasswordConfirmation", "This field cannot be blank")
	form.CheckField(form.NewPassword == form.NewPasswordConfirmation, "newPasswordConfirmation", "Passwords do not match")
	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "password.tmpl", "base", data)
		return
	}

	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	err = app.users.PasswordUpdate(r.Context(), userID, form.CurrentPassword, form.NewPassword)
	if err != nil {
		if errors.Is(err, models.ErrInvalidCredentials) {
			form.AddFieldError("currentPassword", "Current password is incorrect")
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
	rooms, err := app.rooms.ByUser(r.Context(), userID)
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

	form.CheckField(validator.NotBlank(form.Name), "name", "This field cannot be blank")

	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "create_room.html", "base", data)
		return
	}

	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	id, err := app.rooms.Create(r.Context(), userID, form.Name)
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
	isInRoom, err := app.rooms.HasUser(r.Context(), roomID, userID)
	if err != nil || !isInRoom {
		// TODO: Change to custom "you have no access to this room or it does not exist"
		app.notFound(w)
		return
	}

	room, err := app.rooms.Get(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	players, err := app.rooms.PlayersWithSheets(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	current, others := extractPlayerByUserID(players, userID)

	roomInvite, err := app.roomInvites.GetInvite(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	data := app.newTemplateData(r)
	data.PlayerViews = others
	data.CurrentPlayerView = current
	data.Room = room
	if roomInvite != nil {
		inviteLink := makeInviteLink(roomInvite.Token, getOrigin(r))
		data.RoomInvite = roomInvite
		data.InviteLink = inviteLink
	}
	data.HideLayout = true

	_, ok := app.hubMap[roomID]
	if !ok {
		hub := app.NewRoom(roomID, getOrigin(r))
		app.hubMap[roomID] = hub
		go hub.Run()
	}

	app.render(w, http.StatusOK, "view_room.html", "base", data)
}

func (app *application) accountSheets(w http.ResponseWriter, r *http.Request) {
	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
	characterSheetsSummuries, err := app.characterSheets.SummaryByUser(r.Context(), userID)
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

	characterSheet, err := app.characterSheets.Get(r.Context(), sheetID)
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

	data := &templateData{
		CharacterSheetContent: characterSheetContent,
		CharacterSheet:        characterSheet,
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
	isInRoom, err := app.rooms.HasUser(r.Context(), roomID, userID)
	if err != nil || !isInRoom {
		app.notFound(w)
		return
	}

	room, err := app.rooms.Get(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	players, err := app.rooms.PlayersWithSheets(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	current, others := extractPlayerByUserID(players, userID)

	roomInvite, err := app.roomInvites.GetInvite(r.Context(), roomID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	characterSheet, err := app.characterSheets.Get(r.Context(), sheetID)
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
		inviteLink := makeInviteLink(roomInvite.Token, getOrigin(r))
		data.RoomInvite = roomInvite
		data.InviteLink = inviteLink
	}
	data.HideLayout = true

	data.CharacterSheetContent = characterSheetContent
	data.CharacterSheet = characterSheet

	_, ok := app.hubMap[roomID]
	if !ok {
		hub := app.NewRoom(roomID, getOrigin(r))
		app.hubMap[roomID] = hub
		go hub.Run()
	}

	app.render(w, http.StatusOK, "view_room.html", "base", data)
}

func (app *application) redeemInvite(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	token, err := uuid.Parse(params.ByName("token"))
	if err != nil {
		app.serverError(w, err)
		// app.clientError(w, http.StatusNotFound)
		return
	}

	userID := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")

	roomID, _, err := app.roomInvites.TryEnterRoom(r.Context(), token, userID, models.RolePlayer)
	if err != nil {
		app.serverError(w, err)
		// app.clientError(w, http.StatusNotFound)
		return
	}

	http.Redirect(w, r, "/room/view/"+strconv.Itoa(roomID), http.StatusSeeOther)
}
