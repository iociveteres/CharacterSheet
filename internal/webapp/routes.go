package webapp

import (
	"mime"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/ui"
	"github.com/alehano/reverse"
	"github.com/julienschmidt/httprouter"
	"github.com/justinas/alice"
)

func (app *Application) Routes() http.Handler {
	router := httprouter.New()

	router.NotFound = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		app.notFound(w)
	})

	mime.AddExtensionType(".js", "Application/javascript; charset=utf-8")
	fileServer := http.FileServer(http.FS(ui.StaticFS()))
	static := alice.New(app.cacheStaticAssets)
	router.Handler(http.MethodGet, "/static/*filepath", static.Then(fileServer))

	router.HandlerFunc(http.MethodGet, "/health", app.health)
	router.HandlerFunc(http.MethodGet, "/readiness", app.readiness)
	router.HandlerFunc(http.MethodGet, "/ping", ping)
	router.HandlerFunc(http.MethodGet, "/stats/online", app.onlineUsersHandler)

	dynamic := alice.New(app.SessionManager.LoadAndSave, noSurf, app.authenticate)

	router.Handler(http.MethodGet, routeAdd("Home", "/"), dynamic.ThenFunc(app.home))
	router.Handler(http.MethodGet, routeAdd("UserSignup", "/user/signup"), dynamic.ThenFunc(app.userSignup))
	router.Handler(http.MethodPost, reverse.Get("UserSignup"), dynamic.ThenFunc(app.userSignupPost))

	router.Handler(http.MethodGet, routeAdd("UserVerify", "/user/verify/token/:token", ":token"), dynamic.ThenFunc(app.userVerify))
	router.Handler(http.MethodPost, reverse.Get("UserVerify"), dynamic.ThenFunc(app.userVerifyPost))

	router.Handler(http.MethodGet, routeAdd("UserResendVerification", "/user/verify/resend"), dynamic.ThenFunc(app.userResendVerification))
	router.Handler(http.MethodPost, reverse.Get("UserResendVerification"), dynamic.ThenFunc(app.userResendVerificationPost))

	router.Handler(http.MethodGet, routeAdd("UserLogin", "/user/login"), dynamic.ThenFunc(app.userLogin))
	router.Handler(http.MethodPost, reverse.Get("UserLogin"), dynamic.ThenFunc(app.userLoginPost))

	router.Handler(http.MethodGet, routeAdd("PasswordRequestReset", "/user/password/request-reset"), dynamic.ThenFunc(app.userPasswordRequestReset))
	router.Handler(http.MethodPost, reverse.Get("PasswordRequestReset"), dynamic.ThenFunc(app.userPasswordRequestResetPost))

	router.Handler(http.MethodGet, routeAdd("About", "/about"), dynamic.ThenFunc(app.about))
	router.Handler(http.MethodGet, routeAdd("Donate", "/donate"), dynamic.ThenFunc(app.donate))

	protected := dynamic.Append(app.requireAuthentication)
	router.Handler(http.MethodGet, routeAdd("AccountView", "/account/view"), protected.ThenFunc(app.accountView))

	router.Handler(http.MethodGet, routeAdd("PasswordReset", "/account/password/reset/:token", ":token"), dynamic.ThenFunc(app.accountPasswordReset))
	router.Handler(http.MethodPost, reverse.Get("PasswordReset"), dynamic.ThenFunc(app.accountPasswordResetPost))

	router.Handler(http.MethodPost, routeAdd("UserLogout", "/user/logout"), protected.ThenFunc(app.userLogoutPost))

	router.Handler(http.MethodGet, routeAdd("AccountSheets", "/account/sheets"), protected.ThenFunc(app.accountSheets))
	router.Handler(http.MethodGet, routeAdd("AccountRooms", "/account/rooms"), protected.ThenFunc(app.accountRooms))

	router.Handler(http.MethodGet, routeAdd("RoomCreate", "/room/create"), protected.ThenFunc(app.roomCreate))
	router.Handler(http.MethodPost, reverse.Get("RoomCreate"), protected.ThenFunc(app.roomCreatePost))
	routeAdd("RoomDelete", "/room/delete/:id", ":id")
	router.Handler(http.MethodGet, reverse.Get("RoomDelete"), protected.ThenFunc(app.roomDelete))
	router.Handler(http.MethodPost, reverse.Get("RoomDelete"), protected.ThenFunc(app.roomDeletePost))
	router.Handler(http.MethodGet, routeAdd("RoomView", "/room/view/:id", ":id"), protected.ThenFunc(app.roomView))

	router.Handler(http.MethodGet, routeAdd("ViewRoomWithSheet", "/room/sheet/view/:roomid/:sheetid", ":roomid", ":sheetid"), protected.ThenFunc(app.roomViewWithSheet))

	router.Handler(http.MethodGet, routeAdd("SheetView", "/sheet/view/:id"), protected.ThenFunc(app.sheetView))
	router.Handler(http.MethodGet, routeAdd("exportSheet", "/sheet/export/:id", ":id"), protected.ThenFunc(app.sheetExport))
	router.Handler(http.MethodPost, routeAdd("importSheet", "/sheet/import"), protected.ThenFunc(app.sheetImport))

	router.Handler(http.MethodGet, routeAdd("EncounterView", "/encounter/:id", ":id"), protected.ThenFunc(app.encounterView))
	// httprouter takes no static segment beside a parameter: /encounters/load, not /encounter/load.
	router.Handler(http.MethodGet, "/encounter/:id/export", protected.ThenFunc(app.encounterExport))
	router.Handler(http.MethodPost, "/encounter/:id/npcs", protected.ThenFunc(app.encounterReplaceNpcs))
	router.Handler(http.MethodPost, "/encounters/load", protected.ThenFunc(app.encountersLoad))

	router.Handler(http.MethodGet, routeAdd("Bestiary", "/bestiary"), protected.ThenFunc(app.bestiaryPage))
	router.Handler(http.MethodGet, "/bestiary/collections", protected.ThenFunc(app.bestiaryGet))
	router.Handler(http.MethodPost, "/bestiary/collections", protected.ThenFunc(app.collectionCreate))
	router.Handler(http.MethodGet, "/bestiary/collections/:id", protected.ThenFunc(app.collectionGet))
	router.Handler(http.MethodPatch, "/bestiary/collections/:id", protected.ThenFunc(app.collectionUpdate))
	router.Handler(http.MethodDelete, "/bestiary/collections/:id", protected.ThenFunc(app.collectionDelete))
	router.Handler(http.MethodGet, "/bestiary/collections/:id/export", protected.ThenFunc(app.collectionExport))
	router.Handler(http.MethodPost, "/bestiary/collections/:id/creatures", protected.ThenFunc(app.creatureCreate))
	router.Handler(http.MethodPut, "/bestiary/subscriptions/:id", protected.ThenFunc(app.subscriptionPut))
	router.Handler(http.MethodDelete, "/bestiary/subscriptions/:id", protected.ThenFunc(app.subscriptionDelete))
	router.Handler(http.MethodGet, "/bestiary/catalog", protected.ThenFunc(app.catalog))
	router.Handler(http.MethodPost, "/bestiary/collections/:id/upload", protected.ThenFunc(app.collectionUpload))
	router.Handler(http.MethodGet, "/bestiary/creatures", protected.ThenFunc(app.creatureList))
	router.Handler(http.MethodDelete, "/bestiary/creatures/:id", protected.ThenFunc(app.creatureDelete))
	router.Handler(http.MethodPost, "/bestiary/creatures/:id/copy", protected.ThenFunc(app.creatureCopy))
	router.Handler(http.MethodPost, "/bestiary/creatures/:id/move", protected.ThenFunc(app.creatureMove))
	router.Handler(http.MethodPost, "/bestiary/save", protected.ThenFunc(app.bestiarySave))
	router.Handler(http.MethodPost, "/bestiary/add-variant", protected.ThenFunc(app.bestiaryAddVariant))
	router.Handler(http.MethodGet, "/bestiary/ws", protected.ThenFunc(func(w http.ResponseWriter, r *http.Request) {
		app.WSServer.BestiaryWs(app.userID(r), w, r)
	}))

	router.Handler(http.MethodGet, routeAdd("RedeemInvite", "/invite/token/:token", ":token"), protected.ThenFunc(app.redeemInvite))

	router.Handler(http.MethodGet, "/room/ws/:id", protected.ThenFunc(
		func(w http.ResponseWriter, r *http.Request) {
			params := httprouter.ParamsFromContext(r.Context())
			roomID, err := strconv.Atoi(params.ByName("id"))
			userID := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")

			if err != nil || roomID < 1 {
				app.notFound(w)
				return
			}

			// The hub broadcasts chat and room changes to every client, so only
			// members may join it; not found, as roomView answers non-members.
			isInRoom, err := app.Models.Rooms.HasUser(r.Context(), roomID, userID)
			if err != nil {
				app.serverError(w, err)
				return
			}
			if !isInRoom {
				app.notFound(w)
				return
			}

			app.WSServer.SheetWs(roomID, userID, w, r)
		},
	))

	standard := alice.New(app.recoverPanic, app.logRequest, secureHeaders)
	return standard.Then(router)
}


func routeAdd(name, pattern string, params ...string) (result string) {
    defer func() {
        if recover() != nil {
            result = reverse.Get(name) 
        }
    }()
    result = reverse.Add(name, pattern, params...)
    return
}
