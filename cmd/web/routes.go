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
	router.Handler(http.MethodGet, "/static/*filepath", fileServer)

	router.HandlerFunc(http.MethodGet, "/ping", ping)

	// unprotected routes
	dynamic := alice.New(app.sessionManager.LoadAndSave, noSurf, app.authenticate)

	router.Handler(http.MethodGet, "/", dynamic.ThenFunc(app.home))
	// router.Handler(http.MethodGet, "/sheet/view/:id", dynamic.ThenFunc(app.sheetView))
	router.Handler(http.MethodGet, "/user/signup", dynamic.ThenFunc(app.userSignup))
	router.Handler(http.MethodPost, "/user/signup", dynamic.ThenFunc(app.userSignupPost))
	router.Handler(http.MethodGet, "/user/login", dynamic.ThenFunc(app.userLogin))
	router.Handler(http.MethodPost, "/user/login", dynamic.ThenFunc(app.userLoginPost))

	// protected routes
	protected := dynamic.Append(app.requireAuthentication)
	router.Handler(http.MethodGet, "/account/view", protected.ThenFunc(app.accountView))
	router.Handler(http.MethodGet, "/account/password/update", protected.ThenFunc(app.accountPasswordUpdate))
	router.Handler(http.MethodPost, "/account/password/update", protected.ThenFunc(app.accountPasswordUpdatePost))
	router.Handler(http.MethodPost, "/user/logout", protected.ThenFunc(app.userLogoutPost))

	router.Handler(http.MethodGet, "/account/sheets", protected.ThenFunc(app.accountSheets))
	router.Handler(http.MethodGet, "/account/rooms", protected.ThenFunc(app.accountRooms))
	router.Handler(http.MethodGet, "/room/create", protected.ThenFunc(app.roomCreate))
	router.Handler(http.MethodPost, "/room/create", protected.ThenFunc(app.roomCreatePost))
	router.Handler(http.MethodGet, "/room/view/:id", protected.ThenFunc(app.roomView))

	router.Handler(http.MethodGet, "/sheet/view/:id", protected.ThenFunc(app.sheetViewHandler))
	router.Handler(http.MethodGet, "/sheet/show", protected.ThenFunc(app.sheetShow))

	router.Handler(http.MethodGet, reverse.Add("RedeemInvite", "/invite/:token", ":token"), protected.ThenFunc(app.redeemInvite))

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
