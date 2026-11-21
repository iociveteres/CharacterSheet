package webapp

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

const (
	deletePage = "/account/delete/token/" + mocks.DeleteToken
	cancelLink = "/account/deletion/cancel/token/" + mocks.CancelToken
)

// otherBrowser is a client of the same server with its own cookies: another session.
func (ts *testServer) otherBrowser(t *testing.T) *testServer {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := *ts.client
	client.Jar = jar
	return &testServer{Server: ts.Server, client: &client}
}

func users(app *Application) *mocks.UserModel {
	return app.Models.Users.(*mocks.UserModel)
}

// scheduleAlice puts Alice into her grace period, as a deletion scheduled elsewhere would.
func scheduleAlice(app *Application) {
	m := users(app)
	if _, err := m.ScheduleDeletion(context.Background(), 1, mocks.DeleteToken, models.DeletionChoices{}); err != nil {
		panic(err)
	}
}

// csrfOf is the CSRF token of the page at path, for a client that has none yet.
func (ts *testServer) csrfOf(t *testing.T, path string) string {
	t.Helper()
	_, _, body := ts.get(t, path)
	return extractCSRFToken(t, body)
}

func TestDeletionPhraseMatches(t *testing.T) {
	ru := i18n.T("ru", "site.account.delete.phrase", i18n.Params{"name": "Alice"})
	en := i18n.T("en", "site.account.delete.phrase", i18n.Params{"name": "Alice"})
	for _, typed := range []string{ru, en, "  " + strings.ToUpper(ru) + " ", strings.ToLower(en)} {
		if !deletionPhraseMatches(typed, "Alice") {
			t.Errorf("%q does not match", typed)
		}
	}
	other := i18n.T("en", "site.account.delete.phrase", i18n.Params{"name": "Bob"})
	for _, typed := range []string{"", "Alice", other} {
		if deletionPhraseMatches(typed, "Alice") {
			t.Errorf("%q matches", typed)
		}
	}
}

// The Account page emails the link of the deletion page, once in 10 minutes.
func TestDeleteLinkEmail(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	code, header, _ := ts.postForm(t, "/account/delete", url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/view")
	code, _, _ = ts.postForm(t, "/account/delete", url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusTooManyRequests)

	mails := app.sentMails()
	if len(mails) != 1 {
		t.Fatalf("%d emails, want 1", len(mails))
	}
	assert.Equal(t, mails[0].Recipient, "alice@example.com")
	assert.StringContains(t, mails[0].PlainBody, deletePage)
}

// The link opens for its own user only, after a sign-in if need be.
func TestDeletePageNeedsItsUser(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	code, header, _ := ts.get(t, deletePage)
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")
	token := ts.csrfOf(t, "/user/login")
	code, header, _ = ts.postForm(t, "/user/login", url.Values{"email": {"alice@example.com"}, "password": {"pa$$word"}, "csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), deletePage)

	code, _, body := ts.get(t, deletePage)
	assert.Equal(t, code, http.StatusOK)
	// The heir picked by default is selected.
	assert.StringContains(t, body, `<option value="3" selected>`)
	for _, path := range []string{"/account/delete/token/" + mocks.OthersDeleteToken, "/account/delete/token/unknown"} {
		code, _, _ := ts.get(t, path)
		assert.Equal(t, code, http.StatusNotFound)
	}
}

// The right phrase schedules the deletion: the other sessions of the user become a guest's, the
// open tabs close, the email with the cancel link goes out and this browser gets the grace page.
func TestScheduleDeletion(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	other := ts.otherBrowser(t)
	other.login(t)
	token := ts.login(t)
	tab := ts.dialBestiary(t)
	for deadline := time.Now().Add(5 * time.Second); app.WSServer.TotalOnlineUsers() == 0; time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("the tab did not register")
		}
	}

	form := url.Values{"csrf_token": {token}, "chat": {"true"}, "heirs[1]": {"2"}, "phrase": {"delete someone else"}}
	code, _, _ := ts.postForm(t, deletePage, form)
	assert.Equal(t, code, http.StatusUnprocessableEntity)
	if users(app).Deletion != nil {
		t.Fatal("a wrong phrase scheduled the deletion")
	}

	form.Set("phrase", "  "+strings.ToUpper(i18n.T("ru", "site.account.delete.phrase", i18n.Params{"name": "Alice"}))+" ")
	code, header, _ := ts.postForm(t, deletePage, form)
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/deletion")
	d := users(app).Deletion
	if d == nil || !d.ChatMessages || d.ForumPosts || d.PublicCollections || d.Heirs[1] != 2 {
		t.Fatalf("scheduled %+v", d)
	}

	code, _, _ = ts.get(t, "/account/deletion")
	assert.Equal(t, code, http.StatusOK)
	for name, client := range map[string]*testServer{"this": ts, "other": other} {
		code, header, _ := client.get(t, "/account/view")
		if code != http.StatusSeeOther || header.Get("Location") != "/user/login" {
			t.Errorf("%s session is still signed in: %d %s", name, code, header.Get("Location"))
		}
	}
	// No session of hers is left in the store, the other browser's included.
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

	mails := app.sentMails()
	if len(mails) != 1 || !strings.Contains(mails[0].PlainBody, cancelLink) {
		t.Fatalf("emails %+v, want one with the cancel link", mails)
	}
}

// The right password in the grace period opens the grace page and nothing else; a wrong one is
// an ordinary failed login.
func TestLoginInGracePeriod(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	scheduleAlice(app)
	token := ts.csrfOf(t, "/user/login")

	code, _, _ := ts.postForm(t, "/user/login", url.Values{"email": {"alice@example.com"}, "password": {"wrong"}, "csrf_token": {token}})
	assert.Equal(t, code, http.StatusUnprocessableEntity)
	code, _, _ = ts.get(t, "/account/deletion")
	assert.Equal(t, code, http.StatusSeeOther)

	code, header, _ := ts.postForm(t, "/user/login", url.Values{"email": {"alice@example.com"}, "password": {"pa$$word"}, "csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/deletion")
	code, _, _ = ts.get(t, "/account/deletion")
	assert.Equal(t, code, http.StatusOK)
	for _, path := range []string{"/account/view", "/account/rooms", "/bestiary"} {
		code, header, _ := ts.get(t, path)
		if code != http.StatusSeeOther || header.Get("Location") != "/user/login" {
			t.Errorf("%s: %d %s, want the login page", path, code, header.Get("Location"))
		}
	}

	// Cancelling from the grace page signs in.
	code, header, _ = ts.postForm(t, "/account/deletion/cancel", url.Values{"csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/rooms")
	if users(app).Deletion != nil {
		t.Error("the deletion is still pending")
	}
	code, _, _ = ts.get(t, "/account/view")
	assert.Equal(t, code, http.StatusOK)
	code, _, _ = ts.get(t, "/account/deletion")
	assert.Equal(t, code, http.StatusSeeOther)
}

// A password reset in the grace period brings the grace page, not a sign-in.
func TestPasswordResetInGracePeriod(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	scheduleAlice(app)
	token := ts.csrfOf(t, "/account/password/reset/abcdefghabcdefgh")

	code, header, _ := ts.postForm(t, "/account/password/reset/abcdefghabcdefgh", url.Values{
		"token": {"abcdefghabcdefgh"}, "newPassword": {"new password"}, "newPasswordConfirmation": {"new password"}, "csrf_token": {token}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/deletion")
	code, _, _ = ts.get(t, "/account/deletion")
	assert.Equal(t, code, http.StatusOK)
	code, _, _ = ts.get(t, "/account/view")
	assert.Equal(t, code, http.StatusSeeOther)
}

// The cancel link of an email shows a button and cancels by POST only, without a sign-in; the
// grace page of a cancelled deletion sends to the login page.
func TestCancelLink(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	scheduleAlice(app)
	token := ts.csrfOf(t, "/user/login")
	ts.postForm(t, "/user/login", url.Values{"email": {"alice@example.com"}, "password": {"pa$$word"}, "csrf_token": {token}})

	mail := ts.otherBrowser(t)
	code, _, body := mail.get(t, cancelLink)
	assert.Equal(t, code, http.StatusOK)
	if users(app).Deletion == nil {
		t.Fatal("opening the link cancelled the deletion")
	}
	code, header, _ := mail.postForm(t, cancelLink, url.Values{"csrf_token": {extractCSRFToken(t, body)}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")
	if users(app).Deletion != nil {
		t.Fatal("the deletion is still pending")
	}

	code, header, _ = ts.get(t, "/account/deletion")
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")
	code, header, _ = mail.get(t, "/account/deletion/cancel/token/unknown")
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")
	// A second press finds nothing to cancel.
	code, header, _ = mail.postForm(t, cancelLink, url.Values{"csrf_token": {extractCSRFToken(t, body)}})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")
}
