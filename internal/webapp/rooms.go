package webapp

import (
	"errors"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"charactersheet.iociveteres.net/internal/util"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/alehano/reverse"
	"github.com/google/uuid"
	"github.com/julienschmidt/httprouter"
)

func (app *Application) accountRooms(w http.ResponseWriter, r *http.Request) {
	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	roomsWithRole, err := app.Models.Rooms.ByUserWithRole(r.Context(), userID)
	if err != nil {
		if errors.Is(err, models.ErrNoRecord) {
			http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		} else {
			app.serverError(w, err)
		}
		return
	}

	data := app.newTemplateData(r)
	data.RoomsWithRole = roomsWithRole
	app.render(w, http.StatusOK, "rooms.html", "base", data)
}

type roomCreateForm struct {
	Name                string `form:"roomName"`
	validator.Validator `form:"-"`
}

func (app *Application) roomCreate(w http.ResponseWriter, r *http.Request) {
	data := app.newTemplateData(r)

	data.Form = roomCreateForm{}

	app.render(w, http.StatusOK, "create_room.html", "base", data)
}

func (app *Application) roomCreatePost(w http.ResponseWriter, r *http.Request) {
	var form roomCreateForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(validator.NotBlank(form.Name), "roomName", "This field cannot be blank")

	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "create_room.html", "base", data)
		return
	}

	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	id, err := app.Models.Rooms.Create(r.Context(), userID, form.Name)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.SessionManager.Put(r.Context(), "flash", "Room successfully created!")

	http.Redirect(w, r, reverse.Rev("RoomView", strconv.Itoa(id)), http.StatusSeeOther)
}

type roomDeleteForm struct {
	ID                  int `form:"id"`
	validator.Validator `form:"-"`
}

func (app *Application) roomDelete(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	id, err := strconv.Atoi(params.ByName("id"))
	if err != nil || id < 1 {
		app.notFound(w)
		return
	}

	data := app.newTemplateData(r)
	data.Form = roomDeleteForm{
		ID: id,
	}
	app.render(w, http.StatusOK, "delete_room.html", "base", data)
}

func (app *Application) roomDeletePost(w http.ResponseWriter, r *http.Request) {
	var form roomDeleteForm
	err := app.decodePostForm(r, &form)
	if err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	form.Check(form.ID > 0, "id", "Invalid room ID")

	if !form.Valid() {
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusUnprocessableEntity, "delete_room.html", "base", data)
		return
	}

	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	err = app.Models.Rooms.Remove(r.Context(), form.ID, userID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.SessionManager.Put(r.Context(), "flash", "Room successfully deleted!")
	http.Redirect(w, r, reverse.Rev("AccountRooms"), http.StatusSeeOther)
}

func (app *Application) roomView(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	roomID, err := strconv.Atoi(params.ByName("id"))
	if err != nil || roomID < 1 {
		app.notFound(w)
		return
	}

	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")

	data, err := app.prepareRoomViewData(w, r, roomID, userID)
	if err != nil {
		if data == nil {
			app.notFound(w)
		} else {
			app.serverError(w, err)
		}
		return
	}

	app.WSServer.GetOrInitHub(roomID)
	app.render(w, http.StatusOK, "view_room.html", "base", data)
}

func (app *Application) prepareRoomViewData(w http.ResponseWriter, r *http.Request, roomID, userID int) (*templates.Data, error) {
	isInRoom, err := app.Models.Rooms.HasUser(r.Context(), roomID, userID)
	if err != nil || !isInRoom {
		return nil, err
	}

	room, err := app.Models.Rooms.Get(r.Context(), roomID)
	if err != nil {
		return nil, err
	}

	players, err := app.Models.Rooms.PlayersWithSheets(r.Context(), roomID)
	if err != nil {
		return nil, err
	}

	current, others := extractPlayerByUserID(players, userID)

	roomInvite, err := app.Models.RoomInvites.GetInvite(r.Context(), roomID)
	if err != nil {
		return nil, err
	}

	dicePresets, err := app.Models.RoomDicePresets.GetForUser(r.Context(), userID, roomID)
	if err != nil {
		dicePresets = []models.DicePreset{}
	}

	messagePage, err := app.Models.RoomMessages.GetMessagePage(r.Context(), roomID, 0, 50)
	if err != nil {
		return nil, err
	}

	data := app.newTemplateData(r)
	data.PlayerViews = others
	data.CurrentPlayerView = current
	data.Room = room
	data.DicePresets = dicePresets
	data.MessagePage = messagePage
	data.AvailableCommands = commands.AvailableCommands()

	if roomInvite != nil {
		inviteLink := util.MakeInviteLink(roomInvite.Token, app.BaseURL)
		data.RoomInvite = roomInvite
		data.InviteLink = inviteLink
	}

	data.HideLayout = true

	return data, nil
}

func (app *Application) roomViewWithSheet(w http.ResponseWriter, r *http.Request) {
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

	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
	data, err := app.prepareRoomViewData(w, r, roomID, userID)
	if err != nil {
		if data == nil {
			app.notFound(w)
		} else {
			app.serverError(w, err)
		}
		return
	}

	sheetView, characterSheetContent, err := app.getCharacterSheetData(r, userID, sheetID)
	if err != nil {
		switch err {
		case models.ErrNoRecord:
			app.SessionManager.Put(r.Context(), "flash", "The specified character sheet was deleted or did not exist")
			http.Redirect(w, r, reverse.Rev("RoomView", params.ByName("roomid")), http.StatusSeeOther)
		case models.ErrPermissionDenied:
			app.clientError(w, http.StatusForbidden)
		default:
			app.serverError(w, err)
		}
		return
	}

	data.CharacterSheetContent = characterSheetContent
	data.CharacterSheet = sheetView.CharacterSheet
	data.CanEditSheet = sheetView.CanEdit

	app.WSServer.GetOrInitHub(roomID)
	app.render(w, http.StatusOK, "view_room.html", "base", data)
}

func (app *Application) redeemInvite(w http.ResponseWriter, r *http.Request) {
	params := httprouter.ParamsFromContext(r.Context())
	token, err := uuid.Parse(params.ByName("token"))
	if err != nil {
		// app.serverError(w, err)
		app.clientError(w, http.StatusNotFound)
		return
	}

	userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")

	roomID, _, err := app.Models.RoomInvites.TryEnterRoom(r.Context(), token, userID, models.RolePlayer)
	if err != nil {
		if errors.Is(err, models.ErrLinkInvalid) {
			app.clientError(w, http.StatusNotFound)
			return
		}
		app.serverError(w, err)
		return
	}

	user, err := app.Models.Users.Get(r.Context(), userID)
	if err != nil {
		app.serverError(w, err)
		return
	}

	app.WSServer.NewPlayerHandler(app.WSServer.HubMap[roomID], userID, user.Name, user.CreatedAt)

	http.Redirect(w, r, reverse.Rev("RoomView", strconv.Itoa(roomID)), http.StatusSeeOther)
}

// extractPlayerByUserID finds the player with given userID, returns a pointer to it
// and a slice with that player removed (preserves order). If not found, selected is nil
// and rest is the original slice.
func extractPlayerByUserID(players []*models.PlayerView, userID int) (selected *models.PlayerView, rest []*models.PlayerView) {
	for i := range players {
		if players[i].User.ID == userID {
			selected = players[i]
			rest = append(players[:i], players[i+1:]...)
			players[len(players)-1] = nil
			return selected, rest
		}
	}
	return nil, players
}
