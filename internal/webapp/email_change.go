package webapp

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/alehano/reverse"
	"github.com/julienschmidt/httprouter"
)

// The email change of plan _prd/account_name_email, sections 4–6: the form of the Account page
// asks for the password and mails a link to the current address; that link mails one to the new
// address, which changes the email; the old address then gets a link that puts it back for a week.
// The links work without a sign-in: the token and the mailbox are the proof. Each opens a page with
// a button, since mail scanners open links on their own (decision 18 of the account deletion).

type accountEmailForm struct {
	Email               string `form:"email"`
	Password            string `form:"password"`
	validator.Validator `form:"-"`
}

func (app *Application) accountEmail(w http.ResponseWriter, r *http.Request) {
	app.renderEmailForm(w, r, http.StatusOK, accountEmailForm{})
}

func (app *Application) renderEmailForm(w http.ResponseWriter, r *http.Request, status int, form accountEmailForm) {
	user, err := app.Models.Users.Get(r.Context(), app.userID(r))
	if err != nil {
		app.serverError(w, err)
		return
	}
	form.Password = ""
	data := app.newTemplateData(r)
	data.User = user
	data.Form = form
	data.Head = &templates.PageHead{Viewport: true}
	app.render(w, status, "account_email.html", "base", data)
}

// accountEmailPost mails the link of the change to the current address. The limit counts only a
// form that passed its checks, so a typo in the address costs nothing; a wrong password counts, as
// it is checked with the change.
func (app *Application) accountEmailPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	var form accountEmailForm
	if err := app.decodePostForm(r, &form); err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	user, err := app.Models.Users.Get(r.Context(), app.userID(r))
	if err != nil {
		app.serverError(w, err)
		return
	}

	form.Email = strings.TrimSpace(form.Email)
	form.Check(validator.NotBlank(form.Email), "email", i18n.T(lang, "server.errors.form.blank"))
	form.Check(validator.Matches(form.Email, validator.EmailRX), "email", i18n.T(lang, "server.errors.form.email"))
	// The model refuses it as taken; the user is better told why.
	form.Check(form.Email != user.Email, "email", i18n.T(lang, "site.account.email.same"))
	form.Check(validator.NotBlank(form.Password), "password", i18n.T(lang, "server.errors.form.blank"))
	if !form.Valid() {
		app.renderEmailForm(w, r, http.StatusUnprocessableEntity, form)
		return
	}

	if ok, wait := app.limits.emailChangePerUser.Allow(app.signedInUser(r)); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
		form.AddNonFieldError(tooManyAttempts(lang, wait))
		app.renderEmailForm(w, r, http.StatusTooManyRequests, form)
		return
	}

	token, err := app.Models.Users.RequestEmailChange(r.Context(), user.ID, form.Password, form.Email)
	switch {
	case errors.Is(err, models.ErrInvalidCredentials):
		form.AddError("password", i18n.T(lang, "server.errors.form.currentPasswordIncorrect"))
	case errors.Is(err, models.ErrDuplicateEmail):
		form.AddError("email", i18n.T(lang, "server.errors.form.emailInUse"))
	case err != nil:
		app.serverError(w, err)
		return
	}
	if !form.Valid() {
		app.renderEmailForm(w, r, http.StatusUnprocessableEntity, form)
		return
	}

	mailLang := mailLanguage(r, user)
	app.background(func() {
		data := map[string]any{
			"Name":        user.Name,
			"NewEmail":    token.Email,
			"ConfirmLink": app.BaseURL + reverse.Rev("AccountEmailOld", token.Plaintext),
		}
		if err := app.Mailer.Send(user.Email, mailLang, "email_change_old", data); err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("send email change link to the old address of user %d: %s", user.ID, err))
		}
	})

	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "site.account.email.linkSent", i18n.Params{"email": user.Email}))
	http.Redirect(w, r, reverse.Rev("AccountView"), http.StatusSeeOther)
}

// accountEmailCancelPost drops the change in progress from the Account page.
func (app *Application) accountEmailCancelPost(w http.ResponseWriter, r *http.Request) {
	if err := app.Models.Users.CancelEmailChange(r.Context(), app.userID(r)); err != nil {
		app.serverError(w, err)
		return
	}
	lang := i18n.FromContext(r.Context())
	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "site.account.email.cancelled"))
	http.Redirect(w, r, reverse.Rev("AccountView"), http.StatusSeeOther)
}

// renderEmailLink draws a page of a link of an email change: what its button does, and then what it did.
func (app *Application) renderEmailLink(w http.ResponseWriter, r *http.Request, status int, page templates.EmailLinkPage) {
	// The token is in the address: the next page must not get it as a referrer (the template's
	// meta), nor a shared cache the page.
	w.Header().Add("Cache-Control", "no-store")
	data := app.newTemplateData(r)
	data.Token = httprouter.ParamsFromContext(r.Context()).ByName("token")
	data.EmailLink = &page
	data.Head = &templates.PageHead{Viewport: true}
	app.render(w, status, "email_link.html", "base", data)
}

// emailLinkInvalid is the page of a link used, expired or never made: not found, as a deletion
// link of another user.
func (app *Application) emailLinkInvalid(w http.ResponseWriter, r *http.Request, step string) {
	app.renderEmailLink(w, r, http.StatusNotFound, templates.EmailLinkPage{Step: step, State: templates.EmailLinkInvalid})
}

// emailLinkConfirm shows the button of a link of the scope, with the address the token carries.
func (app *Application) emailLinkConfirm(w http.ResponseWriter, r *http.Request, scope models.TokenScope, step string) {
	token := httprouter.ParamsFromContext(r.Context()).ByName("token")
	email, err := app.Models.Tokens.Email(r.Context(), scope, token)
	if errors.Is(err, models.ErrNoRecord) {
		app.emailLinkInvalid(w, r, step)
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	app.renderEmailLink(w, r, http.StatusOK, templates.EmailLinkPage{Step: step, State: templates.EmailLinkConfirm, Email: email})
}

func (app *Application) accountEmailOld(w http.ResponseWriter, r *http.Request) {
	app.emailLinkConfirm(w, r, models.ScopeChangeEmailOld, templates.EmailStepOld)
}

// accountEmailOldPost confirms the change from the current address and mails the link to the new
// one.
func (app *Application) accountEmailOldPost(w http.ResponseWriter, r *http.Request) {
	token, err := app.Models.Users.ConfirmOldEmail(r.Context(), httprouter.ParamsFromContext(r.Context()).ByName("token"))
	if errors.Is(err, models.ErrNoRecord) {
		app.emailLinkInvalid(w, r, templates.EmailStepOld)
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	user, err := app.Models.Users.Get(r.Context(), token.UserID)
	if err != nil {
		app.serverError(w, err)
		return
	}
	mailLang := mailLanguage(r, user)
	app.background(func() {
		data := map[string]any{
			"Name":        user.Name,
			"ConfirmLink": app.BaseURL + reverse.Rev("AccountEmailNew", token.Plaintext),
		}
		if err := app.Mailer.Send(token.Email, mailLang, "email_change_new", data); err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("send email change link to the new address of user %d: %s", user.ID, err))
		}
	})
	app.renderEmailLink(w, r, http.StatusOK, templates.EmailLinkPage{Step: templates.EmailStepOld, State: templates.EmailLinkDone, Email: token.Email})
}

func (app *Application) accountEmailNew(w http.ResponseWriter, r *http.Request) {
	app.emailLinkConfirm(w, r, models.ScopeChangeEmailNew, templates.EmailStepNew)
}

// accountEmailNewPost changes the email and mails the old address the link that puts it back.
// The sessions stay: the owner has shown both mailboxes.
func (app *Application) accountEmailNewPost(w http.ResponseWriter, r *http.Request) {
	token := httprouter.ParamsFromContext(r.Context()).ByName("token")
	// For the page of an address taken since: ConfirmNewEmail uses the token up and doesn't say.
	email, err := app.Models.Tokens.Email(r.Context(), models.ScopeChangeEmailNew, token)
	if err != nil && !errors.Is(err, models.ErrNoRecord) {
		app.serverError(w, err)
		return
	}
	changed, err := app.Models.Users.ConfirmNewEmail(r.Context(), token)
	if errors.Is(err, models.ErrNoRecord) {
		app.emailLinkInvalid(w, r, templates.EmailStepNew)
		return
	}
	if errors.Is(err, models.ErrDuplicateEmail) {
		app.renderEmailLink(w, r, http.StatusConflict, templates.EmailLinkPage{Step: templates.EmailStepNew, State: templates.EmailLinkTaken, Email: email})
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	user, err := app.Models.Users.Get(r.Context(), changed.UserID)
	if err != nil {
		app.serverError(w, err)
		return
	}
	mailLang := mailLanguage(r, user)
	app.background(func() {
		data := map[string]any{
			"Name":       user.Name,
			"NewEmail":   maskEmail(changed.NewEmail),
			"RevertLink": app.BaseURL + reverse.Rev("AccountEmailRevert", changed.RevertToken),
		}
		if err := app.Mailer.Send(changed.OldEmail, mailLang, "email_changed", data); err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("send email changed to the old address of user %d: %s", user.ID, err))
		}
	})
	app.renderEmailLink(w, r, http.StatusOK, templates.EmailLinkPage{Step: templates.EmailStepNew, State: templates.EmailLinkDone, Email: changed.NewEmail})
}

func (app *Application) accountEmailRevert(w http.ResponseWriter, r *http.Request) {
	app.emailLinkConfirm(w, r, models.ScopeRevertEmail, templates.EmailStepRevert)
}

// accountEmailRevertPost puts the old address back and closes every session and open tab of the
// account: whoever changed the email may be signed in. The page offers the password reset, whose
// link goes to the address put back.
func (app *Application) accountEmailRevertPost(w http.ResponseWriter, r *http.Request) {
	token := httprouter.ParamsFromContext(r.Context()).ByName("token")
	userID, email, err := app.Models.Users.RevertEmail(r.Context(), token)
	if errors.Is(err, models.ErrNoRecord) {
		app.emailLinkInvalid(w, r, templates.EmailStepRevert)
		return
	}
	if errors.Is(err, models.ErrDuplicateEmail) {
		// The revert link keeps its address from everyone else (models.emailTaken): this one was
		// taken by hand. The model rolled back, the token is still there.
		email, _ := app.Models.Tokens.Email(r.Context(), models.ScopeRevertEmail, token)
		app.renderEmailLink(w, r, http.StatusConflict, templates.EmailLinkPage{Step: templates.EmailStepRevert, State: templates.EmailLinkTaken, Email: email})
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	signedOut := app.userID(r) == userID
	app.closeUserSessions(r, userID)
	if signedOut {
		// authenticate looked before the session went: the nav of the page must not show it.
		r = r.WithContext(context.WithValue(r.Context(), isAuthenticatedContextKey, false))
	}
	app.renderEmailLink(w, r, http.StatusOK, templates.EmailLinkPage{Step: templates.EmailStepRevert, State: templates.EmailLinkDone, Email: email})
}

// closeUserSessions signs the user out everywhere and closes their open tabs, as the scheduling
// of a deletion does; a failure is only logged.
func (app *Application) closeUserSessions(r *http.Request, userID int) {
	if err := app.destroySessions(r, userID); err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("destroy sessions of user %d: %s", userID, err))
	}
	// A hub checks the user only when a socket connects: the open tabs are closed here.
	rooms, err := app.Models.Rooms.ByUser(r.Context(), userID)
	if err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("rooms of user %d to close sockets: %s", userID, err))
	}
	roomIDs := make([]int, len(rooms))
	for i, room := range rooms {
		roomIDs[i] = room.ID
	}
	app.WSServer.KickUser(userID, roomIDs)
}

// maskEmail hides the address of the email_changed letter, which goes to the mailbox the account
// left: "n•••@example.com".
func maskEmail(email string) string {
	local, domain, ok := strings.Cut(email, "@")
	if !ok || local == "" {
		return "•••"
	}
	first, _ := utf8.DecodeRuneInString(local)
	return string(first) + "•••@" + domain
}
