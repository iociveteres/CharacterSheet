package webapp

import (
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/mailer"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

func (ts *testServer) setLangCookie(t *testing.T, lang string) {
	ts.Client().Jar.SetCookies(mustURL(t, ts.URL), []*http.Cookie{{Name: "lang", Value: lang, Path: "/"}})
}

var fieldErrorRX = regexp.MustCompile(`<label class='error'>([^<]*)</label>`)

// mailSubject is the subject of the email name in lang: which language's template a handler
// picked shows in the subject, whatever it says.
func mailSubject(t *testing.T, lang, name string) string {
	t.Helper()
	msg, err := mailer.Render(lang, name, map[string]any{})
	assert.NilError(t, err)
	return msg.Subject
}

func TestSignupMessagesInRequestLanguage(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	ts.setLangCookie(t, "ru")

	_, _, body := ts.get(t, "/user/signup")
	csrf := extractCSRFToken(t, body)

	code, _, body := ts.postForm(t, "/user/signup", url.Values{
		"csrf_token": {csrf}, "name": {""}, "email": {"bob@example.com"}, "password": {"pa$$"},
	})
	assert.Equal(t, code, http.StatusUnprocessableEntity)
	assert.StringContains(t, body, "<html lang='ru'>")
	// The blank name and the short password, the least length named.
	errs := fieldErrorRX.FindAllStringSubmatch(body, -1)
	if len(errs) != 2 || strings.TrimSpace(errs[0][1]) == "" || !strings.Contains(errs[1][1], "8") {
		t.Errorf("field errors %q, want the name's and the password's with 8", errs)
	}

	code, _, _ = ts.postForm(t, "/user/signup", url.Values{
		"csrf_token": {csrf}, "name": {"Bob"}, "email": {"bob@example.com"}, "password": {"validPa$$word"},
	})
	assert.Equal(t, code, http.StatusSeeOther)
	_, _, body = ts.get(t, "/user/login")
	if !regexp.MustCompile(`<div class='flash'>[^<]+</div>`).MatchString(body) {
		t.Error("no flash after the signup")
	}

	// The account keeps the language of the signup, and the email is in it.
	assert.Equal(t, app.Models.Users.(*mocks.UserModel).InsertedLocale, "ru")
	sent := app.sentMails()
	assert.Equal(t, len(sent), 1)
	assert.Equal(t, sent[0].Recipient, "bob@example.com")
	assert.Equal(t, sent[0].Subject, mailSubject(t, "ru", "user_verification"))
}

func TestPasswordResetEmailLanguage(t *testing.T) {
	if mailSubject(t, "ru", "password_change") == mailSubject(t, "en", "password_change") {
		t.Fatal("the subjects of both languages are the same: the test cannot tell them apart")
	}
	tests := []struct {
		name, userLocale, cookie, wantLang string
	}{
		{"the user's language over the request's", "ru", "en", "ru"},
		{"no user's language: the request's", "", "ru", "ru"},
		{"neither", "", "", "en"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			app := newTestApplication(t)
			app.Models.Users.(*mocks.UserModel).Locale = tt.userLocale
			ts := newTestServer(t, app.Routes())
			defer ts.Close()
			if tt.cookie != "" {
				ts.setLangCookie(t, tt.cookie)
			}

			_, _, body := ts.get(t, "/user/password/request-reset")
			code, _, _ := ts.postForm(t, "/user/password/request-reset", url.Values{
				"csrf_token": {extractCSRFToken(t, body)}, "email": {"alice@example.com"},
			})
			assert.Equal(t, code, http.StatusSeeOther)

			sent := app.sentMails()
			assert.Equal(t, len(sent), 1)
			assert.Equal(t, sent[0].Subject, mailSubject(t, tt.wantLang, "password_change"))
		})
	}
}
