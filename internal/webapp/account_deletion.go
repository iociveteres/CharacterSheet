package webapp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/templates"
	"charactersheet.iociveteres.net/internal/util"
	"charactersheet.iociveteres.net/internal/validator"
	"github.com/alehano/reverse"
	"github.com/julienschmidt/httprouter"
)

// The deletion of an account: plan _prd/account_deletion, section 5.1. The link of an email opens
// the deletion page for the signed-in user; the deletion is carried out after a grace period, in
// which the key deletionPendingUserID of a session (not authenticatedUserID) opens the grace page
// and its cancel button.

// deleteLinkTTL is how long the link of the deletion email works.
const deleteLinkTTL = time.Hour

// deletionPendingKey is the session key of a user in the grace period who gave the password.
const deletionPendingKey = "deletionPendingUserID"

// accountDeletePost emails the signed-in user the link of the deletion page.
func (app *Application) accountDeletePost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	user, err := app.Models.Users.Get(r.Context(), app.userID(r))
	if err != nil {
		app.serverError(w, err)
		return
	}
	// Only the last link works.
	if err := app.Models.Tokens.DeleteAllForUser(r.Context(), models.ScopeDeleteAccount, user.ID); err != nil {
		app.serverError(w, err)
		return
	}
	token, err := app.Models.Tokens.New(r.Context(), user.ID, deleteLinkTTL, models.ScopeDeleteAccount)
	if err != nil {
		app.serverError(w, err)
		return
	}
	mailLang := mailLanguage(r, user)
	app.background(func() {
		data := map[string]any{
			"Name":       user.Name,
			"DeleteLink": app.BaseURL + reverse.Rev("AccountDeleteConfirm", token.Plaintext),
		}
		if err := app.Mailer.Send(user.Email, mailLang, "account_delete_link", data); err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("send account deletion link to user %d: %s", user.ID, err))
		}
	})

	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "site.account.delete.linkSent", i18n.Params{"email": user.Email}))
	http.Redirect(w, r, reverse.Rev("AccountView"), http.StatusSeeOther)
}

// refuseDeleteLink shows the Account page again with the error in its deletion block.
func (app *Application) refuseDeleteLink(w http.ResponseWriter, r *http.Request, wait time.Duration) {
	form := accountDeleteLinkForm{}
	form.AddNonFieldError(tooManyAttempts(i18n.FromContext(r.Context()), wait))
	app.renderAccount(w, r, http.StatusTooManyRequests, form)
}

// accountDeleteLinkForm is the button of the deletion block of the Account page; the form carries
// an error when the email is refused.
type accountDeleteLinkForm struct {
	validator.Validator `form:"-"`
}

// accountDeleteForm is the deletion page: the boxes, the heirs by room and the phrase.
type accountDeleteForm struct {
	Phrase              string      `form:"phrase"`
	ChatMessages        bool        `form:"chat"`
	ForumPosts          bool        `form:"posts"`
	PublicCollections   bool        `form:"collections"`
	Heirs               map[int]int `form:"heirs"`
	validator.Validator `form:"-"`
}

// deleteLinkUser checks the token of the deletion link against the signed-in user: a token of
// another user, used or expired, is not found.
func (app *Application) deleteLinkUser(w http.ResponseWriter, r *http.Request) (token string, userID int, ok bool) {
	token = httprouter.ParamsFromContext(r.Context()).ByName("token")
	userID = app.userID(r)
	owner, err := app.Models.Tokens.UserID(r.Context(), models.ScopeDeleteAccount, token)
	if errors.Is(err, models.ErrNoRecord) || (err == nil && owner != userID) {
		app.notFound(w)
		return "", 0, false
	}
	if err != nil {
		app.serverError(w, err)
		return "", 0, false
	}
	return token, userID, true
}

func (app *Application) accountDeleteConfirm(w http.ResponseWriter, r *http.Request) {
	token, userID, ok := app.deleteLinkUser(w, r)
	if !ok {
		return
	}
	summary, err := app.Models.Users.DeletionSummary(r.Context(), userID)
	if err != nil {
		app.serverError(w, err)
		return
	}
	form := accountDeleteForm{Heirs: map[int]int{}}
	for _, room := range summary.OwnedRooms {
		form.Heirs[room.ID] = room.DefaultHeir
	}
	app.renderDeletePage(w, r, http.StatusOK, token, summary, form)
}

func (app *Application) renderDeletePage(w http.ResponseWriter, r *http.Request, status int, token string, summary *models.DeletionSummary, form accountDeleteForm) {
	data := app.newTemplateData(r)
	data.Token = token
	data.DeletionSummary = summary
	data.Form = form
	data.Head = &templates.PageHead{Viewport: true}
	app.render(w, status, "delete_account.html", "base", data)
}

// deletionPhraseMatches says whether typed is the phrase of the deletion page for name in one of
// the languages, so that switching the language does not get in the way; case and the spaces
// around it do not count.
func deletionPhraseMatches(typed, name string) bool {
	typed = strings.TrimSpace(typed)
	for _, lang := range i18n.Languages {
		if strings.EqualFold(typed, strings.TrimSpace(i18n.T(lang, "site.account.delete.phrase", i18n.Params{"name": name}))) {
			return true
		}
	}
	return false
}

// accountDeleteConfirmPost schedules the deletion: the account goes into its grace period, its
// sessions and open sockets close, the email with the cancel link goes out and this browser gets
// the grace page.
func (app *Application) accountDeleteConfirmPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	token, userID, ok := app.deleteLinkUser(w, r)
	if !ok {
		return
	}
	var form accountDeleteForm
	if err := app.decodePostForm(r, &form); err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	user, err := app.Models.Users.Get(r.Context(), userID)
	if err != nil {
		app.serverError(w, err)
		return
	}
	if !deletionPhraseMatches(form.Phrase, user.Name) {
		summary, err := app.Models.Users.DeletionSummary(r.Context(), userID)
		if err != nil {
			app.serverError(w, err)
			return
		}
		if form.Heirs == nil {
			form.Heirs = map[int]int{}
		}
		for _, room := range summary.OwnedRooms {
			if _, ok := form.Heirs[room.ID]; !ok {
				form.Heirs[room.ID] = room.DefaultHeir
			}
		}
		form.AddError("phrase", i18n.T(lang, "site.account.delete.phraseWrong"))
		app.renderDeletePage(w, r, http.StatusUnprocessableEntity, token, summary, form)
		return
	}

	scheduled, err := app.Models.Users.ScheduleDeletion(r.Context(), userID, token, models.DeletionChoices{
		ChatMessages:      form.ChatMessages,
		ForumPosts:        form.ForumPosts,
		PublicCollections: form.PublicCollections,
		Heirs:             form.Heirs,
	})
	if errors.Is(err, models.ErrNoRecord) {
		app.notFound(w)
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}

	// The account no longer passes authenticate, so what is left of its sessions is a guest's
	// either way: a failure here is only logged.
	app.closeUserSessions(r, userID)

	mailLang := mailLanguage(r, user)
	deleteAt := mailDate(mailLang, scheduled.DeleteAt, util.GetTimeLocation(r))
	app.background(func() {
		data := map[string]any{
			"Name":       user.Name,
			"DeleteAt":   deleteAt,
			"CancelLink": app.BaseURL + reverse.Rev("AccountDeletionCancelLink", scheduled.CancelToken),
		}
		if err := app.Mailer.Send(user.Email, mailLang, "account_delete_scheduled", data); err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("send account deletion scheduled to user %d: %s", userID, err))
		}
	})

	// destroySessions emptied the current session: the key goes into a new one.
	app.SessionManager.Put(r.Context(), deletionPendingKey, userID)
	http.Redirect(w, r, reverse.Rev("AccountDeletion"), http.StatusSeeOther)
}

// destroySessions deletes every session of the user, the current one last: the request would
// save it back otherwise. The current session of a guest or another user stays (a revert link of
// email_change.go opens anywhere). Iterate loads every session from the store; at the site's
// numbers that is fine (plan, section 4.1).
func (app *Application) destroySessions(r *http.Request, userID int) error {
	err := app.SessionManager.Iterate(r.Context(), func(ctx context.Context) error {
		if app.SessionManager.GetInt(ctx, "authenticatedUserID") == userID {
			return app.SessionManager.Destroy(ctx)
		}
		return nil
	})
	if err != nil || app.SessionManager.GetInt(r.Context(), "authenticatedUserID") != userID {
		return err
	}
	return app.SessionManager.Destroy(r.Context())
}

// mailDate is the time of an email in the zone of the browser that asked for it, with the zone's
// name: the email is read elsewhere.
func mailDate(lang string, t time.Time, loc *time.Location) string {
	if loc == nil {
		loc = time.UTC
	}
	return i18n.FormatDate(lang, t, loc) + " " + t.In(loc).Format("MST")
}

// pendingDeletion is the user of the session in the grace period and when the deletion comes. A
// session without one, or whose deletion is cancelled or done, goes to the login page.
func (app *Application) pendingDeletion(w http.ResponseWriter, r *http.Request) (int, time.Time, bool) {
	userID := app.SessionManager.GetInt(r.Context(), deletionPendingKey)
	if userID == 0 {
		http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		return 0, time.Time{}, false
	}
	deleteAt, err := app.Models.Users.PendingDeletion(r.Context(), userID)
	if errors.Is(err, models.ErrNoRecord) {
		app.SessionManager.Remove(r.Context(), deletionPendingKey)
		http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		return 0, time.Time{}, false
	}
	if err != nil {
		app.serverError(w, err)
		return 0, time.Time{}, false
	}
	return userID, deleteAt, true
}

// accountDeletion is the grace page: when the account goes, and the button that cancels it.
func (app *Application) accountDeletion(w http.ResponseWriter, r *http.Request) {
	_, deleteAt, ok := app.pendingDeletion(w, r)
	if !ok {
		return
	}
	w.Header().Add("Cache-Control", "no-store")
	data := app.newTemplateData(r)
	data.DeleteAt = deleteAt
	data.Head = &templates.PageHead{Viewport: true}
	app.render(w, http.StatusOK, "account_deletion.html", "base", data)
}

// accountDeletionCancelPost cancels the deletion from the grace page and signs the user in: the
// password was given to get there.
func (app *Application) accountDeletionCancelPost(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	userID, _, ok := app.pendingDeletion(w, r)
	if !ok {
		return
	}
	err := app.Models.Users.CancelDeletion(r.Context(), userID)
	if errors.Is(err, models.ErrNoRecord) {
		// Done by the wipe since pendingDeletion looked.
		app.SessionManager.Remove(r.Context(), deletionPendingKey)
		http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	if err := app.SessionManager.RenewToken(r.Context()); err != nil {
		app.serverError(w, err)
		return
	}
	app.SessionManager.Remove(r.Context(), deletionPendingKey)
	app.SessionManager.Put(r.Context(), "authenticatedUserID", userID)
	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "site.account.delete.cancelled"))
	http.Redirect(w, r, reverse.Rev("AccountRooms"), http.StatusSeeOther)
}

// cancelLinkUser is the user of the token of a cancel link; an unknown or expired one goes to the
// login page with a message.
func (app *Application) cancelLinkUser(w http.ResponseWriter, r *http.Request) (token string, userID int, ok bool) {
	token = httprouter.ParamsFromContext(r.Context()).ByName("token")
	userID, err := app.Models.Tokens.UserID(r.Context(), models.ScopeCancelDeletion, token)
	if errors.Is(err, models.ErrNoRecord) {
		app.cancelLinkInvalid(w, r)
		return "", 0, false
	}
	if err != nil {
		app.serverError(w, err)
		return "", 0, false
	}
	return token, userID, true
}

func (app *Application) cancelLinkInvalid(w http.ResponseWriter, r *http.Request) {
	lang := i18n.FromContext(r.Context())
	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "site.account.delete.cancelLinkInvalid"))
	http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
}

// accountDeletionCancelLink shows the button of the cancel link of an email and cancels nothing:
// mail scanners open links on their own (decision 18).
func (app *Application) accountDeletionCancelLink(w http.ResponseWriter, r *http.Request) {
	token, _, ok := app.cancelLinkUser(w, r)
	if !ok {
		return
	}
	data := app.newTemplateData(r)
	data.Token = token
	data.Head = &templates.PageHead{Viewport: true}
	app.render(w, http.StatusOK, "cancel_deletion.html", "base", data)
}

// accountDeletionCancelLinkPost cancels the deletion without a sign-in and sends to the login
// page.
func (app *Application) accountDeletionCancelLinkPost(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := app.cancelLinkUser(w, r)
	if !ok {
		return
	}
	err := app.Models.Users.CancelDeletion(r.Context(), userID)
	if errors.Is(err, models.ErrNoRecord) {
		app.cancelLinkInvalid(w, r)
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	lang := i18n.FromContext(r.Context())
	app.SessionManager.Put(r.Context(), "flash", i18n.T(lang, "site.account.delete.cancelledSignIn"))
	http.Redirect(w, r, reverse.Rev("UserLogin"), http.StatusSeeOther)
}
