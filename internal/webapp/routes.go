package webapp

import (
	"context"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/ratelimit"
	"charactersheet.iociveteres.net/ui"
	"github.com/alehano/reverse"
	"github.com/julienschmidt/httprouter"
	"github.com/justinas/alice"
)

// limiters hold back what costs the server: bcrypt on login, a mail sent, a
// whole sheet written. Each counts by client address, the email in the form or
// the user.
type limiters struct {
	loginPerAddress  *ratelimit.Limiter
	loginPerEmail    *ratelimit.Limiter
	signupPerAddress *ratelimit.Limiter
	resendPerAddress *ratelimit.Limiter
	resendPerUser    *ratelimit.Limiter
	resetPerAddress  *ratelimit.Limiter
	resetPerEmail    *ratelimit.Limiter
	// Sheet import and the bestiary and encounter uploads share it.
	uploadsPerUser *ratelimit.Limiter
	// The email with the link of the account's deletion page.
	deleteLinkPerUser *ratelimit.Limiter

	all []*ratelimit.Limiter
}

func newLimiters() *limiters {
	ls := &limiters{}
	// n requests per period, burst of them at once.
	add := func(n int, per time.Duration, burst int) *ratelimit.Limiter {
		l := ratelimit.New(ratelimit.Every(n, per), burst)
		ls.all = append(ls.all, l)
		return l
	}
	ls.loginPerAddress = add(10, time.Minute, 5)
	ls.loginPerEmail = add(5, time.Minute, 5)
	ls.signupPerAddress = add(5, time.Hour, 5)
	ls.resendPerAddress = add(3, time.Hour, 3)
	ls.resendPerUser = add(3, time.Hour, 3)
	ls.resetPerAddress = add(3, time.Hour, 3)
	ls.resetPerEmail = add(3, time.Hour, 3)
	ls.uploadsPerUser = add(20, time.Minute, 20)
	ls.deleteLinkPerUser = add(1, 10*time.Minute, 1)
	return ls
}

// StartLimitSweeper forgets, once a minute, the clients that have their
// requests back in full, until ctx is done.
func (app *Application) StartLimitSweeper(ctx context.Context) {
	ratelimit.StartSweeper(ctx, &app.wg, time.Minute, app.limits.all...)
}

// formEmail counts every email alike, whether or not someone has it: a
// refusal must not tell which do.
func formEmail(r *http.Request) string {
	return strings.ToLower(strings.TrimSpace(r.PostFormValue("email")))
}

func (app *Application) resendUser(r *http.Request) string {
	if id := app.SessionManager.GetInt(r.Context(), "resendUserID"); id != 0 {
		return strconv.Itoa(id)
	}
	return ""
}

// signedInUser counts by the signed-in user.
func (app *Application) signedInUser(r *http.Request) string {
	return strconv.Itoa(app.userID(r))
}

// maxFormBody bounds the forms of the auth pages, which nosurf reads whole for
// the CSRF token before the handler runs.
const maxFormBody = 64 * 1024

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

	dynamic := alice.New(app.SessionManager.LoadAndSave, noSurf, app.authenticate, app.language)
	// The body is bounded ahead of noSurf and the rate limited after it: a
	// refused form is shown again with a CSRF token.
	form := alice.New(app.limitBody(maxFormBody)).Extend(dynamic)
	limits := app.limits

	router.Handler(http.MethodGet, routeAdd("Home", "/"), dynamic.ThenFunc(app.home))
	router.Handler(http.MethodGet, routeAdd("UserSignup", "/user/signup"), dynamic.ThenFunc(app.userSignup))
	router.Handler(http.MethodPost, reverse.Get("UserSignup"), form.Append(
		app.rateLimit(limits.signupPerAddress, clientAddress, refuseForm[userSignupForm](app, "signup.html")),
	).ThenFunc(app.userSignupPost))

	router.Handler(http.MethodGet, routeAdd("UserVerify", "/user/verify/token/:token", ":token"), dynamic.ThenFunc(app.userVerify))
	router.Handler(http.MethodPost, reverse.Get("UserVerify"), form.ThenFunc(app.userVerifyPost))

	router.Handler(http.MethodGet, routeAdd("UserResendVerification", "/user/verify/resend"), dynamic.ThenFunc(app.userResendVerification))
	refuseResend := refuseForm[resendVerificationForm](app, "resend_verification.html")
	router.Handler(http.MethodPost, reverse.Get("UserResendVerification"), form.Append(
		app.rateLimit(limits.resendPerAddress, clientAddress, refuseResend),
		app.rateLimit(limits.resendPerUser, app.resendUser, refuseResend),
	).ThenFunc(app.userResendVerificationPost))

	router.Handler(http.MethodGet, routeAdd("UserLogin", "/user/login"), dynamic.ThenFunc(app.userLogin))
	refuseLogin := refuseForm[userLoginForm](app, "login.html")
	router.Handler(http.MethodPost, reverse.Get("UserLogin"), form.Append(
		app.rateLimit(limits.loginPerAddress, clientAddress, refuseLogin),
		app.rateLimit(limits.loginPerEmail, formEmail, refuseLogin),
	).ThenFunc(app.userLoginPost))

	router.Handler(http.MethodGet, routeAdd("PasswordRequestReset", "/user/password/request-reset"), dynamic.ThenFunc(app.userPasswordRequestReset))
	refuseReset := refuseForm[userPasswordRequesRestForm](app, "password_request_reset.html")
	router.Handler(http.MethodPost, reverse.Get("PasswordRequestReset"), form.Append(
		app.rateLimit(limits.resetPerAddress, clientAddress, refuseReset),
		app.rateLimit(limits.resetPerEmail, formEmail, refuseReset),
	).ThenFunc(app.userPasswordRequestResetPost))

	router.Handler(http.MethodGet, routeAdd("About", "/about"), dynamic.ThenFunc(app.about))
	router.Handler(http.MethodGet, routeAdd("Donate", "/donate"), dynamic.ThenFunc(app.donate))
	router.Handler(http.MethodGet, routeAdd("Privacy", "/privacy"), dynamic.ThenFunc(app.privacy))
	router.Handler(http.MethodPost, routeAdd("Language", "/language"), dynamic.ThenFunc(app.languagePost))

	protected := dynamic.Append(app.requireAuthentication)
	uploads := protected.Append(app.rateLimit(limits.uploadsPerUser, app.signedInUser, nil))
	router.Handler(http.MethodGet, routeAdd("AccountView", "/account/view"), protected.ThenFunc(app.accountView))
	router.Handler(http.MethodPut, "/account/avatar", protected.ThenFunc(app.avatarPut))
	router.Handler(http.MethodDelete, "/account/avatar", protected.ThenFunc(app.avatarDelete))
	router.Handler(http.MethodPost, routeAdd("AvatarDelete", "/account/avatar/delete"), protected.ThenFunc(app.avatarDeletePost))
	// Public: no session, no CSRF; anyone may see an avatar (internal/webapp/avatars.go).
	router.HandlerFunc(http.MethodGet, "/avatar/:hash", app.avatarGet)

	// The deletion of the account (account_deletion.go): the email with the link, the deletion
	// page of the link, the grace page and the cancel link of the email.
	router.Handler(http.MethodPost, routeAdd("AccountDelete", "/account/delete"), protected.Append(
		app.rateLimit(limits.deleteLinkPerUser, app.signedInUser, app.refuseDeleteLink),
	).ThenFunc(app.accountDeletePost))
	router.Handler(http.MethodGet, routeAdd("AccountDeleteConfirm", "/account/delete/token/:token", ":token"), protected.ThenFunc(app.accountDeleteConfirm))
	router.Handler(http.MethodPost, reverse.Get("AccountDeleteConfirm"), alice.New(app.limitBody(maxFormBody)).Extend(protected).ThenFunc(app.accountDeleteConfirmPost))
	router.Handler(http.MethodGet, routeAdd("AccountDeletion", "/account/deletion"), dynamic.ThenFunc(app.accountDeletion))
	router.Handler(http.MethodPost, routeAdd("AccountDeletionCancel", "/account/deletion/cancel"), form.ThenFunc(app.accountDeletionCancelPost))
	router.Handler(http.MethodGet, routeAdd("AccountDeletionCancelLink", "/account/deletion/cancel/token/:token", ":token"), dynamic.ThenFunc(app.accountDeletionCancelLink))
	router.Handler(http.MethodPost, reverse.Get("AccountDeletionCancelLink"), form.ThenFunc(app.accountDeletionCancelLinkPost))

	router.Handler(http.MethodGet, routeAdd("PasswordReset", "/account/password/reset/:token", ":token"), dynamic.ThenFunc(app.accountPasswordReset))
	router.Handler(http.MethodPost, reverse.Get("PasswordReset"), form.ThenFunc(app.accountPasswordResetPost))

	router.Handler(http.MethodPost, routeAdd("UserLogout", "/user/logout"), protected.ThenFunc(app.userLogoutPost))

	router.Handler(http.MethodGet, routeAdd("AccountSheets", "/account/sheets"), protected.ThenFunc(app.accountSheets))
	router.Handler(http.MethodGet, routeAdd("AccountRooms", "/account/rooms"), protected.ThenFunc(app.accountRooms))

	router.Handler(http.MethodGet, routeAdd("RoomCreate", "/room/create"), protected.ThenFunc(app.roomCreate))
	router.Handler(http.MethodPost, reverse.Get("RoomCreate"), protected.ThenFunc(app.roomCreatePost))
	routeAdd("RoomDelete", "/room/delete/:id", ":id")
	router.Handler(http.MethodGet, reverse.Get("RoomDelete"), protected.ThenFunc(app.roomDelete))
	router.Handler(http.MethodPost, reverse.Get("RoomDelete"), protected.ThenFunc(app.roomDeletePost))
	router.Handler(http.MethodGet, routeAdd("RoomView", "/room/view/:id", ":id"), protected.ThenFunc(app.roomView))
	router.Handler(http.MethodGet, "/room/state/:id", protected.ThenFunc(app.roomState))

	router.Handler(http.MethodGet, routeAdd("ViewRoomWithSheet", "/room/sheet/view/:roomid/:sheetid", ":roomid", ":sheetid"), protected.ThenFunc(app.roomViewWithSheet))

	router.Handler(http.MethodGet, routeAdd("SheetView", "/sheet/view/:id"), protected.ThenFunc(app.sheetView))
	router.Handler(http.MethodGet, routeAdd("exportSheet", "/sheet/export/:id", ":id"), protected.ThenFunc(app.sheetExport))
	router.Handler(http.MethodPost, routeAdd("importSheet", "/sheet/import"), alice.New(app.limitBody(maxSheetBody)).Extend(uploads).ThenFunc(app.sheetImport))
	router.Handler(http.MethodPut, "/sheet/portrait/:id", protected.ThenFunc(app.portraitPut))
	router.Handler(http.MethodDelete, "/sheet/portrait/:id", protected.ThenFunc(app.portraitDelete))
	router.Handler(http.MethodGet, "/portrait/:hash", protected.ThenFunc(app.portraitGet))

	router.Handler(http.MethodGet, routeAdd("EncounterView", "/encounter/:id", ":id"), protected.ThenFunc(app.encounterView))
	// httprouter takes no static segment beside a parameter: /encounters/load, not /encounter/load.
	router.Handler(http.MethodGet, "/encounter/:id/export", protected.ThenFunc(app.encounterExport))
	router.Handler(http.MethodPost, "/encounter/:id/npcs", uploads.ThenFunc(app.encounterReplaceNpcs))
	router.Handler(http.MethodPost, "/encounters/load", uploads.ThenFunc(app.encountersLoad))

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
	router.Handler(http.MethodPost, "/bestiary/collections/:id/upload", uploads.ThenFunc(app.collectionUpload))
	router.Handler(http.MethodGet, "/bestiary/creatures", protected.ThenFunc(app.creatureList))
	router.Handler(http.MethodDelete, "/bestiary/creatures/:id", protected.ThenFunc(app.creatureDelete))
	router.Handler(http.MethodPost, "/bestiary/creatures/:id/copy", protected.ThenFunc(app.creatureCopy))
	router.Handler(http.MethodPost, "/bestiary/creatures/:id/move", protected.ThenFunc(app.creatureMove))
	router.Handler(http.MethodPost, "/bestiary/save", protected.ThenFunc(app.bestiarySave))
	router.Handler(http.MethodPost, "/bestiary/add-variant", protected.ThenFunc(app.bestiaryAddVariant))
	router.Handler(http.MethodGet, "/bestiary/ws", protected.ThenFunc(func(w http.ResponseWriter, r *http.Request) {
		app.WSServer.BestiaryWs(app.userID(r), w, r)
	}))

	// The forum routes inside its own ServeMux; its route names stay out of reverse.
	forumHandler := dynamic.Then(app.Forum.Handler())
	router.Handler(http.MethodGet, "/forum/*path", forumHandler)
	router.Handler(http.MethodPost, "/forum/*path", forumHandler)

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


// routeAdd names a route for reverse.Rev. The names live in a global of the
// reverse package, and the tests call Routes() once per test server in one
// process: Add panics on a name it already has, the only error it reports, so
// the second call takes the pattern stored by the first.
func routeAdd(name, pattern string, params ...string) (result string) {
    defer func() {
        if recover() != nil {
            result = reverse.Get(name) 
        }
    }()
    result = reverse.Add(name, pattern, params...)
    return
}
