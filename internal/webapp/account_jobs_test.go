package webapp

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
)

// mailTemplates are the templates of the emails sent so far.
func mailTemplates(app *Application) []string {
	var names []string
	for _, m := range app.sentMails() {
		names = append(names, m.Template)
	}
	return names
}

// newJobsApplication is a test application whose routes are named, as serve names them before
// it starts the jobs: the reminder links its cancel route.
func newJobsApplication(t *testing.T) *Application {
	app := newTestApplication(t)
	app.Routes()
	return app
}

func ago(d time.Duration) *time.Time {
	t := time.Now().Add(-d)
	return &t
}

// A reminder that does not go out is tried again on the next pass; one that went out holds the
// wipe back for a day.
func TestAccountJobsRemind(t *testing.T) {
	app := newJobsApplication(t)
	ctx := context.Background()
	m := users(app)
	m.Schedule(time.Now().Add(12*time.Hour), nil)

	app.failMails(errors.New("smtp down"))
	app.runAccountJobs(ctx)
	if remindedAt, wiped := m.State(); remindedAt != nil || wiped {
		t.Fatalf("after a failed reminder: reminded at %v, wiped %v", remindedAt, wiped)
	}

	app.failMails(nil)
	app.runAccountJobs(ctx)
	app.runAccountJobs(ctx)
	if remindedAt, wiped := m.State(); remindedAt == nil || wiped {
		t.Fatalf("after the reminder: reminded at %v, wiped %v", remindedAt, wiped)
	}
	mails := app.sentMails()
	if len(mails) != 1 || mails[0].Template != "account_delete_reminder" || mails[0].Recipient != "alice@example.com" {
		t.Fatalf("emails %v, want one reminder to Alice", mailTemplates(app))
	}
	assert.StringContains(t, mails[0].PlainBody, "/account/deletion/cancel/token/")
	assert.Equal(t, m.PendingOlderThan, 30*24*time.Hour)
}

// The deletion that is due is carried out a day after the reminder, or without one once the
// reminder failed for 7 days after it was due; a reminder sent on the way holds it back.
func TestAccountJobsWipe(t *testing.T) {
	tests := []struct {
		name       string
		deleteAt   time.Duration // ago
		remindedAt *time.Time
		mailsFail  bool
		wiped      bool
		templates  []string
	}{
		{"reminded a day ago", time.Hour, ago(25 * time.Hour), false, true, []string{"account_deleted"}},
		{"reminded lately", time.Hour, ago(2 * time.Hour), false, false, nil},
		{"due, not reminded: the reminder goes first", time.Hour, nil, false, false, []string{"account_delete_reminder"}},
		// A backup restored with the deletion due and the reminder not gone (plan, section 8).
		{"6 days past, not reminded", 6 * 24 * time.Hour, nil, true, false, nil},
		{"8 days past, not reminded", 8 * 24 * time.Hour, nil, true, true, nil},
		{"not due, reminded a day ago", -time.Hour, ago(25 * time.Hour), false, false, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := newJobsApplication(t)
			m := users(app)
			m.Schedule(time.Now().Add(-tt.deleteAt), tt.remindedAt)
			if tt.mailsFail {
				app.failMails(errors.New("smtp down"))
			}

			app.runAccountJobs(context.Background())
			if _, wiped := m.State(); wiped != tt.wiped {
				t.Errorf("wiped %v, want %v", wiped, tt.wiped)
			}
			got := mailTemplates(app)
			if len(got) != len(tt.templates) || (len(got) > 0 && got[0] != tt.templates[0]) {
				t.Errorf("emails %v, want %v", got, tt.templates)
			}
		})
	}
}

// The route of e2e makes the deletion due and runs a pass at once; without -dev there is none.
func TestDevAccountJobsRoute(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	scheduleAlice(app)
	code, _, _ := ts.postForm(t, "/dev/account-jobs/run", url.Values{"userID": {"1"}})
	assert.Equal(t, code, http.StatusNotFound)

	app = newTestApplication(t)
	app.Dev = true
	ts = newTestServer(t, app.Routes())
	defer ts.Close()
	scheduleAlice(app)
	code, _, _ = ts.postForm(t, "/dev/account-jobs/run", url.Values{"userID": {"x"}})
	assert.Equal(t, code, http.StatusBadRequest)
	code, _, _ = ts.postForm(t, "/dev/account-jobs/run", url.Values{"userID": {"1"}})
	assert.Equal(t, code, http.StatusNoContent)
	if _, wiped := users(app).State(); !wiped {
		t.Error("not wiped")
	}
	if got := mailTemplates(app); len(got) != 1 || got[0] != "account_deleted" {
		t.Errorf("emails %v, want the account deleted", got)
	}
	code, _, _ = ts.postForm(t, "/dev/account-jobs/run", url.Values{"userID": {"1"}})
	assert.Equal(t, code, http.StatusNotFound)
}
