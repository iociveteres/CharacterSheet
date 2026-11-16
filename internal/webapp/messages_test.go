package webapp

import (
	"net/http"
	"net/url"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

func (ts *testServer) setLangCookie(t *testing.T, lang string) {
	ts.Client().Jar.SetCookies(mustURL(t, ts.URL), []*http.Cookie{{Name: "lang", Value: lang, Path: "/"}})
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
	assert.StringContains(t, body, "Поле не может быть пустым")
	assert.StringContains(t, body, "Не короче 8 символов")

	code, _, _ = ts.postForm(t, "/user/signup", url.Values{
		"csrf_token": {csrf}, "name": {"Bob"}, "email": {"bob@example.com"}, "password": {"validPa$$word"},
	})
	assert.Equal(t, code, http.StatusSeeOther)
	_, _, body = ts.get(t, "/user/login")
	assert.StringContains(t, body, "Вы зарегистрировались")

	// The account keeps the language of the signup, and the email is in it.
	assert.Equal(t, app.Models.Users.(*mocks.UserModel).InsertedLocale, "ru")
	sent := app.sentMails()
	assert.Equal(t, len(sent), 1)
	assert.Equal(t, sent[0].Recipient, "bob@example.com")
	assert.Equal(t, sent[0].Subject, "Подтверждение аккаунта на Character Sheet")
}

func TestPasswordResetEmailLanguage(t *testing.T) {
	tests := []struct {
		name, userLocale, cookie, wantSubject string
	}{
		{"the user's language over the request's", "ru", "en", "Смена пароля на Character Sheet"},
		{"no user's language: the request's", "", "ru", "Смена пароля на Character Sheet"},
		{"neither", "", "", "Charactersheet password change"},
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
			assert.Equal(t, sent[0].Subject, tt.wantSubject)
		})
	}
}
