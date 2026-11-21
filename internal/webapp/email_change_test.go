package webapp

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

const (
	emailOldLink    = "/account/email/old/token/" + mocks.EmailOldToken
	emailNewLink    = "/account/email/new/token/" + mocks.EmailNewToken
	emailRevertLink = "/account/email/revert/token/" + mocks.EmailRevertToken
)

// requestEmailChange sends the form of the email change as the signed-in Alice.
func (ts *testServer) requestEmailChange(t *testing.T, token, email, password string) (int, http.Header) {
	t.Helper()
	code, header, _ := ts.postForm(t, "/account/email", url.Values{"csrf_token": {token}, "email": {email}, "password": {password}})
	return code, header
}

// The form checks the address and the password before anything goes out; the right ones mail
// the link to the current address, and the Account page shows the change until it is cancelled.
func TestEmailChangeRequest(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	code, header, _ := ts.get(t, "/account/email")
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")

	token := ts.login(t)
	code, _, body := ts.get(t, "/account/email")
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `href="mailto:iociveteres@gmail.com"`)

	refused := map[string][2]string{
		"blank address":  {"", "pa$$word"},
		"not an address": {"new.example.com", "pa$$word"},
		"own address":    {"alice@example.com", "pa$$word"},
		"taken address":  {"dupe@example.com", "pa$$word"},
		"wrong password": {"new@example.com", "wrong"},
		"blank password": {"new@example.com", ""},
	}
	for name, form := range refused {
		t.Run(name, func(t *testing.T) {
			code, _ := ts.requestEmailChange(t, token, form[0], form[1])
			assert.Equal(t, code, http.StatusUnprocessableEntity)
			assert.Equal(t, users(app).PendingEmail, "")
		})
	}
	if mails := app.sentMails(); len(mails) != 0 {
		t.Fatalf("a refused form sent %d emails", len(mails))
	}

	code, header = ts.requestEmailChange(t, token, " new@example.com ", "pa$$word")
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/view")
	assert.Equal(t, users(app).PendingEmail, "new@example.com")
	mails := app.sentMails()
	if len(mails) != 1 {
		t.Fatalf("%d emails, want 1", len(mails))
	}
	assert.Equal(t, mails[0].Recipient, "alice@example.com")
	assert.Equal(t, mails[0].Template, "email_change_old")
	assert.StringContains(t, mails[0].PlainBody, emailOldLink)
	assert.StringContains(t, mails[0].PlainBody, "new@example.com")

	_, _, body = ts.get(t, "/account/view")
	assert.StringContains(t, body, `class="account-email-pending"`)
	code, header, _ = ts.postForm(t, "/account/email/cancel", url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/view")
	assert.Equal(t, users(app).PendingEmail, "")
	_, _, body = ts.get(t, "/account/view")
	if strings.Contains(body, `class="account-email-pending"`) {
		t.Error("the cancelled change is still shown")
	}
}

// Three requests may go at once, then one in 10 minutes; a form refused by its own checks does
// not count.
func TestEmailChangeLimit(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	for range 5 {
		code, _ := ts.requestEmailChange(t, token, "not an address", "pa$$word")
		assert.Equal(t, code, http.StatusUnprocessableEntity)
	}
	code, _ := ts.requestEmailChange(t, token, "new@example.com", "wrong")
	assert.Equal(t, code, http.StatusUnprocessableEntity)
	for range 2 {
		code, _ := ts.requestEmailChange(t, token, "new@example.com", "pa$$word")
		assert.Equal(t, code, http.StatusSeeOther)
	}
	code, header := ts.requestEmailChange(t, token, "other@example.com", "pa$$word")
	assert.Equal(t, code, http.StatusTooManyRequests)
	if header.Get("Retry-After") == "" {
		t.Error("no Retry-After")
	}
	assert.Equal(t, users(app).PendingEmail, "new@example.com")
	assert.Equal(t, len(app.sentMails()), 2)
}

// The links work without a sign-in: each opens a page with a button and does nothing until it is
// pressed. The old address's link mails the new address's; that one changes the email and mails
// the revert link to the old address.
func TestEmailChangeLinks(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	users(app).PendingEmail = "new@example.com"
	token := ts.csrfOf(t, "/user/login")

	code, _, body := ts.get(t, emailOldLink)
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `data-state="confirm"`)
	assert.Equal(t, len(app.sentMails()), 0)

	code, _, body = ts.postForm(t, emailOldLink, url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `data-state="done"`)
	mails := app.sentMails()
	if len(mails) != 1 {
		t.Fatalf("%d emails, want 1", len(mails))
	}
	assert.Equal(t, mails[0].Recipient, "new@example.com")
	assert.Equal(t, mails[0].Template, "email_change_new")
	assert.StringContains(t, mails[0].PlainBody, emailNewLink)

	code, _, _ = ts.get(t, emailNewLink)
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, users(app).Email, "")
	code, _, body = ts.postForm(t, emailNewLink, url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `data-state="done"`)
	assert.Equal(t, users(app).Email, "new@example.com")
	mails = app.sentMails()
	if len(mails) != 2 {
		t.Fatalf("%d emails, want 2", len(mails))
	}
	assert.Equal(t, mails[1].Recipient, "alice@example.com")
	assert.Equal(t, mails[1].Template, "email_changed")
	assert.StringContains(t, mails[1].PlainBody, emailRevertLink)
	// The new address is masked in the letter to the mailbox the account left.
	assert.StringContains(t, mails[1].PlainBody, "n•••@example.com")
	if strings.Contains(mails[1].PlainBody, "new@example.com") {
		t.Error("the letter to the old address shows the new one")
	}

	// Used up.
	code, _, body = ts.postForm(t, emailNewLink, url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusNotFound)
	assert.StringContains(t, body, `data-state="invalid"`)
}

// An address registered by someone else since the request stops the change at its last step.
func TestEmailTakenAtLastStep(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	users(app).PendingEmail = mocks.LateTakenEmail
	token := ts.csrfOf(t, "/user/login")

	code, _, body := ts.postForm(t, emailNewLink, url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusConflict)
	assert.StringContains(t, body, `data-state="taken"`)
	assert.Equal(t, users(app).Email, "")
	assert.Equal(t, users(app).PendingEmail, "")
	assert.Equal(t, len(app.sentMails()), 0)
}

// The revert link, opened in a browser of nobody in particular, puts the old address back and
// signs the account out everywhere, its open tabs too.
func TestEmailRevert(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	signedIn := ts.otherBrowser(t)
	signedIn.login(t)
	tab := signedIn.dialBestiary(t)
	for deadline := time.Now().Add(5 * time.Second); app.WSServer.TotalOnlineUsers() == 0; time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("the tab did not register")
		}
	}
	users(app).Email = "new@example.com"
	token := ts.csrfOf(t, "/user/login")

	code, _, _ := ts.get(t, emailRevertLink)
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, users(app).Reverted, false)

	code, _, body := ts.postForm(t, emailRevertLink, url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `data-state="done"`)
	// The password reset of the page goes to the address put back.
	assert.StringContains(t, body, `name='email' value='alice@example.com'`)
	assert.Equal(t, users(app).Reverted, true)
	assert.Equal(t, users(app).Email, "alice@example.com")

	code, header, _ := signedIn.get(t, "/account/view")
	if code != http.StatusSeeOther || header.Get("Location") != "/user/login" {
		t.Errorf("the other browser is still signed in: %d %s", code, header.Get("Location"))
	}
	err := app.SessionManager.Iterate(context.Background(), func(ctx context.Context) error {
		if app.SessionManager.GetInt(ctx, "authenticatedUserID") == 1 {
			t.Error("a session of the user stays in the store")
		}
		return nil
	})
	assert.NilError(t, err)
	tab.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, msg, err := tab.ReadMessage(); err == nil {
		t.Errorf("the open tab is still connected, got %s", msg)
	}

	code, _, _ = ts.postForm(t, emailRevertLink, url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusNotFound)
}

// Opened in a browser signed in to the account, the revert page is drawn for a guest: its own
// session is gone.
func TestEmailRevertSignsOutThisBrowser(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	code, _, body := ts.postForm(t, emailRevertLink, url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusOK)
	if strings.Contains(body, `action='/user/logout'`) {
		t.Error("the page shows the session it closed")
	}
	code, header, _ := ts.get(t, "/account/view")
	if code != http.StatusSeeOther || header.Get("Location") != "/user/login" {
		t.Errorf("this browser is still signed in: %d %s", code, header.Get("Location"))
	}
}

// A link never made, used or expired, or of another step, is a page that says so, not an error.
func TestEmailBadLinks(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.csrfOf(t, "/user/login")

	for _, path := range []string{
		"/account/email/old/token/unknown",
		"/account/email/new/token/unknown",
		"/account/email/revert/token/unknown",
		"/account/email/old/token/" + mocks.EmailNewToken,
		"/account/email/new/token/" + mocks.EmailRevertToken,
		"/account/email/revert/token/" + mocks.EmailOldToken,
	} {
		code, _, body := ts.get(t, path)
		if code != http.StatusNotFound || !strings.Contains(body, `data-state="invalid"`) {
			t.Errorf("GET %s: %d", path, code)
		}
		code, _, body = ts.postForm(t, path, url.Values{"csrf_token": {token}})
		if code != http.StatusNotFound || !strings.Contains(body, `data-state="invalid"`) {
			t.Errorf("POST %s: %d", path, code)
		}
	}
	// No change is in progress: the right tokens find nothing either.
	for _, path := range []string{emailOldLink, emailNewLink} {
		code, _, _ := ts.postForm(t, path, url.Values{"csrf_token": {token}})
		assert.Equal(t, code, http.StatusNotFound)
	}
}

func TestMaskEmail(t *testing.T) {
	for in, want := range map[string]string{
		"nikolay@example.com": "n•••@example.com",
		"ёж@пример.рф":        "ё•••@пример.рф",
		"x@example.com":       "x•••@example.com",
		"no-at-sign":          "•••",
		"@example.com":        "•••",
	} {
		assert.Equal(t, maskEmail(in), want)
	}
}
