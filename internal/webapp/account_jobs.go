package webapp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"github.com/alehano/reverse"
)

// The background job of the accounts: plan _prd/account_deletion, section 7.2.

const (
	accountJobsEvery = 10 * time.Minute
	// remindBefore is how long before the deletion the reminder goes out, and how long after it
	// the wipe waits (section 8: a restored backup must not wipe someone who cancelled).
	remindBefore = 24 * time.Hour
	// pendingAccountAge is when an account whose email was never confirmed goes (decision 10).
	pendingAccountAge = 30 * 24 * time.Hour
)

// StartAccountJobs makes a pass of the account jobs now and every 10 minutes, until ctx is done.
func (app *Application) StartAccountJobs(ctx context.Context) {
	app.wg.Add(1)
	go func() {
		defer app.wg.Done()
		ticker := time.NewTicker(accountJobsEvery)
		defer ticker.Stop()
		for {
			app.runAccountJobs(ctx)
			select {
			case <-ticker.C:
			case <-ctx.Done():
				return
			}
		}
	}()
}

// runAccountJobs makes one pass: the reminders, the wipes that are due and the accounts never
// confirmed. A failure is logged and the pass goes on; what failed is tried on the next one.
func (app *Application) runAccountJobs(ctx context.Context) {
	app.accountJobs.Lock()
	defer app.accountJobs.Unlock()

	accounts, err := app.Models.Users.PendingAccounts(ctx)
	if err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("account jobs: pending accounts: %s", err))
	}
	for _, a := range accounts {
		app.pendingAccountStep(ctx, a, time.Now())
	}

	n, err := app.Models.Users.DeletePending(ctx, pendingAccountAge)
	if err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("account jobs: delete pending accounts: %s", err))
	} else if n > 0 {
		app.InfoLog.Printf("deleted %d accounts never confirmed", n)
	}
}

// pendingAccountStep reminds the user a day before the deletion and wipes the account a day
// after the reminder. A reminder that does not go out holds the wipe back for up to
// ReminderWait after the deletion was due, then the account is wiped without it (decision 21).
func (app *Application) pendingAccountStep(ctx context.Context, a models.PendingAccount, now time.Time) {
	// A panic over one account must not hold back the others, nor stop the job.
	defer func() {
		if v := recover(); v != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("account jobs: user %d: %v", a.UserID, v))
		}
	}()
	unreminded := a.RemindedAt == nil && now.Sub(a.DeleteAt) >= models.ReminderWait
	if a.RemindedAt == nil && !unreminded && a.DeleteAt.Sub(now) < remindBefore {
		if err := app.remindDeletion(ctx, a); err != nil {
			app.ErrorLog.Output(2, fmt.Sprintf("account jobs: remind user %d: %s", a.UserID, err))
			return
		}
		a.RemindedAt = &now
	}
	reminded := a.RemindedAt != nil && now.Sub(*a.RemindedAt) >= remindBefore
	if now.Before(a.DeleteAt) || !(reminded || unreminded) {
		return
	}
	app.wipeAccount(ctx, a.UserID, unreminded)
}

// remindDeletion emails the reminder with a cancel link of its own: the tokens are stored as
// hashes, the first email's can't be sent again. reminded_at is set only once the email went out.
func (app *Application) remindDeletion(ctx context.Context, a models.PendingAccount) error {
	token, err := app.Models.Tokens.New(ctx, a.UserID, time.Until(a.DeleteAt)+models.ReminderWait, models.ScopeCancelDeletion)
	if err != nil {
		return err
	}
	lang := jobMailLanguage(a.Locale)
	data := map[string]any{
		"Name":       a.Name,
		"DeleteAt":   mailDate(lang, a.DeleteAt, nil),
		"CancelLink": app.BaseURL + reverse.Rev("AccountDeletionCancelLink", token.Plaintext),
	}
	if err := app.Mailer.Send(a.Email, lang, "account_delete_reminder", data); err != nil {
		return err
	}
	return app.Models.Users.MarkReminded(ctx, a.UserID)
}

// wipeAccount carries out the deletion and, after its commit, tells the open rooms and emails
// the former address. The log line has the id only: it is for working out what happened.
func (app *Application) wipeAccount(ctx context.Context, userID int, unreminded bool) {
	w, err := app.Models.Users.Wipe(ctx, userID)
	if errors.Is(err, models.ErrNoRecord) {
		// Cancelled since the pass read it.
		return
	}
	if err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("account jobs: wipe user %d: %s", userID, err))
		return
	}
	if unreminded {
		app.InfoLog.Printf("account %d deleted without reminder", userID)
	} else {
		app.InfoLog.Printf("account %d deleted", userID)
	}
	app.WSServer.PlayerDeleted(userID, w.Rooms)
	if err := app.Mailer.Send(w.Email, jobMailLanguage(w.Locale), "account_deleted", map[string]any{"Name": w.Name}); err != nil {
		app.ErrorLog.Output(2, fmt.Sprintf("account jobs: send account deleted to user %d: %s", userID, err))
	}
}

// jobMailLanguage is the language of an email the job sends: the user's, else the default, as
// there is no request to take one from.
func jobMailLanguage(locale string) string {
	if i18n.Supported(locale) {
		return locale
	}
	return i18n.Default
}

// devAccountJobsRun makes the deletion of the user due and runs a pass of the account jobs at
// once, for e2e: it has no access to the database. Only under -dev, without a session or CSRF.
func (app *Application) devAccountJobsRun(w http.ResponseWriter, r *http.Request) {
	userID, err := strconv.Atoi(r.FormValue("userID"))
	if err != nil || userID < 1 {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	err = app.Models.Users.HurryDeletion(r.Context(), userID)
	if errors.Is(err, models.ErrNoRecord) {
		app.notFound(w)
		return
	}
	if err != nil {
		app.serverError(w, err)
		return
	}
	app.runAccountJobs(r.Context())
	w.WriteHeader(http.StatusNoContent)
}
