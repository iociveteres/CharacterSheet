package main

import (
	"mime"
	"net/http"
	"strconv"

	"charactersheet.iociveteres.net/ui"
	"github.com/alehano/reverse"
	"github.com/julienschmidt/httprouter"
	"github.com/justinas/alice"
)

func (app *application) routes() http.Handler {
	router := httprouter.New()

	// wrap httprouter notFound with app.notFound
	router.NotFound = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		app.notFound(w)
	})

	mime.AddExtensionType(".js", "application/javascript; charset=utf-8")
	fileServer := http.FileServer(http.FS(ui.Files))
	static := alice.New(app.cacheStaticAssets)
	router.Handler(http.MethodGet, "/static/*filepath", static.Then(fileServer))

	// Health check endpoints
	router.HandlerFunc(http.MethodGet, "/health", app.health)
	router.HandlerFunc(http.MethodGet, "/readiness", app.readiness)
	router.HandlerFunc(http.MethodGet, "/ping", ping)

	// unprotected routes
	dynamic := alice.New(app.sessionManager.LoadAndSave, noSurf, app.authenticate)

	router.Handler(http.MethodGet, reverse.Add("Home", "/"), dynamic.ThenFunc(app.home))
	router.Handler(http.MethodGet, reverse.Add("UserSignup", "/user/signup"), dynamic.ThenFunc(app.userSignup))
	router.Handler(http.MethodPost, reverse.Get("UserSignup"), dynamic.ThenFunc(app.userSignupPost))

	router.Handler(http.MethodGet, reverse.Add("UserVerify", "/user/verify/token/:token", ":token"), dynamic.ThenFunc(app.userVerify))
	router.Handler(http.MethodPost, reverse.Get("UserVerify"), dynamic.ThenFunc(app.userVerifyPost))

	router.Handler(http.MethodGet, reverse.Add("UserResendVerification", "/user/verify/resend"), dynamic.ThenFunc(app.userResendVerification))
	router.Handler(http.MethodPost, reverse.Get("UserResendVerification"), dynamic.ThenFunc(app.userResendVerificationPost))

	router.Handler(http.MethodGet, reverse.Add("UserLogin", "/user/login"), dynamic.ThenFunc(app.userLogin))
	router.Handler(http.MethodPost, reverse.Get("UserLogin"), dynamic.ThenFunc(app.userLoginPost))

	router.Handler(http.MethodGet, reverse.Add("PasswordRequestReset", "/user/password/request-reset"), dynamic.ThenFunc(app.userPasswordRequestReset))
	router.Handler(http.MethodPost, reverse.Get("PasswordRequestReset"), dynamic.ThenFunc(app.userPasswordRequestResetPost))

	router.Handler(http.MethodGet, reverse.Add("About", "/about"), dynamic.ThenFunc(app.about))
	router.Handler(http.MethodGet, reverse.Add("Donate", "/donate"), dynamic.ThenFunc(app.donate))
	// protected routes
	protected := dynamic.Append(app.requireAuthentication)
	router.Handler(http.MethodGet, reverse.Add("AccountView", "/account/view"), protected.ThenFunc(app.accountView))

	router.Handler(http.MethodGet, reverse.Add("PasswordReset", "/account/password/reset/:token", ":token"), dynamic.ThenFunc(app.accountPasswordReset))
	router.Handler(http.MethodPost, reverse.Get("PasswordReset"), dynamic.ThenFunc(app.accountPasswordResetPost))

	router.Handler(http.MethodPost, reverse.Add("UserLogout", "/user/logout"), protected.ThenFunc(app.userLogoutPost))

	router.Handler(http.MethodGet, reverse.Add("AccountSheets", "/account/sheets"), protected.ThenFunc(app.accountSheets))
	router.Handler(http.MethodGet, reverse.Add("AccountRooms", "/account/rooms"), protected.ThenFunc(app.accountRooms))

	router.Handler(http.MethodGet, reverse.Add("RoomCreate", "/room/create"), protected.ThenFunc(app.roomCreate))
	router.Handler(http.MethodPost, reverse.Get("RoomCreate"), protected.ThenFunc(app.roomCreatePost))
	reverse.Add("RoomDelete", "/room/delete/:id", ":id")
	router.Handler(http.MethodGet, reverse.Get("RoomDelete"), protected.ThenFunc(app.roomDelete))
	router.Handler(http.MethodPost, reverse.Get("RoomDelete"), protected.ThenFunc(app.roomDeletePost))
	router.Handler(http.MethodGet, reverse.Add("RoomView", "/room/view/:id", ":id"), protected.ThenFunc(app.roomView))

	// I have struggled with this route.
	// On one hand /room/view/:roomid/sheet/:sheetid conflicts with /room/view/:id, and httprouter is strict about conflicts.
	// I do not want to move to gorilla mux as order of declaring routes matters there.
	// Query parameter /room/view/:id?=sheet:1 doesn't even need new handler, but AFAIK query parameters
	// are meant to control how same resource is presented, and sheet is another resource.
	// So abomination of /room/view/sheet/:roomid/:sheetid is here.
	router.Handler(http.MethodGet, reverse.Add("ViewRoomWithSheet", "/room/sheet/view/:roomid/:sheetid", ":roomid", ":sheetid"), protected.ThenFunc(app.roomViewWithSheet))

	router.Handler(http.MethodGet, reverse.Add("SheetView", "/sheet/view/:id"), protected.ThenFunc(app.sheetView))
	router.Handler(http.MethodGet, reverse.Add("SheetShow", "/sheet/show"), protected.ThenFunc(app.sheetShow))
	router.Handler(http.MethodGet, reverse.Add("exportSheet", "/sheet/export/:id", ":id"), protected.ThenFunc(app.sheetExport))
	router.Handler(http.MethodPost, reverse.Add("importSheet", "/sheet/import"), protected.ThenFunc(app.sheetImport))

	router.Handler(http.MethodGet, reverse.Add("RedeemInvite", "/invite/token/:token", ":token"), protected.ThenFunc(app.redeemInvite))

	router.Handler(http.MethodGet, "/room/ws/:id", protected.ThenFunc(
		func(w http.ResponseWriter, r *http.Request) {
			params := httprouter.ParamsFromContext(r.Context())
			roomID, err := strconv.Atoi(params.ByName("id"))

			if err != nil || roomID < 1 {
				app.notFound(w)
				return
			}

			app.SheetWs(roomID, w, r)
		},
	))

	standard := alice.New(app.recoverPanic, app.logRequest, secureHeaders)
	return standard.Then(router)
}
