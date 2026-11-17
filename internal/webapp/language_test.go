package webapp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

func TestLanguageSources(t *testing.T) {
	app := newTestApplication(t)
	tests := []struct {
		name           string
		userLocale     *string
		cookie         string
		acceptLanguage string
		want           string
	}{
		{"nothing", nil, "", "", "en"},
		{"Accept-Language", nil, "", "ru-RU,ru;q=0.9", "ru"},
		{"cookie over Accept-Language", nil, "en", "ru-RU,ru;q=0.9", "en"},
		{"user's choice over cookie", ptr("ru"), "en", "en", "ru"},
		{"user without a choice: cookie", ptr(""), "ru", "en", "ru"},
		{"unknown cookie is skipped", nil, "de", "ru", "ru"},
		{"unknown user's locale is skipped", ptr("de"), "", "ru", "ru"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.userLocale != nil {
				r = r.WithContext(context.WithValue(r.Context(), userLocaleContextKey, *tt.userLocale))
			}
			if tt.cookie != "" {
				r.AddCookie(&http.Cookie{Name: "lang", Value: tt.cookie})
			}
			if tt.acceptLanguage != "" {
				r.Header.Set("Accept-Language", tt.acceptLanguage)
			}
			var got string
			app.language(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got = i18n.FromContext(r.Context())
			})).ServeHTTP(httptest.NewRecorder(), r)
			assert.Equal(t, got, tt.want)
		})
	}
}

func ptr(s string) *string { return &s }

func langCookieOf(t *testing.T, header http.Header) *http.Cookie {
	t.Helper()
	for _, c := range (&http.Response{Header: header}).Cookies() {
		if c.Name == "lang" {
			return c
		}
	}
	t.Fatal("no lang cookie set")
	return nil
}

func TestLanguagePostGuest(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	_, _, body := ts.get(t, "/about")
	assert.StringContains(t, body, "<html lang='en'>")
	assert.StringContains(t, body, "<option value='en' lang='en' selected>English</option>")
	csrf := extractCSRFToken(t, body)

	code, header, _ := ts.postForm(t, "/language", url.Values{
		"csrf_token": {csrf}, "lang": {"ru"}, "redirect": {"/about?x=1"},
	})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/about?x=1")
	c := langCookieOf(t, header)
	assert.Equal(t, c.Value, "ru")
	assert.Equal(t, c.Path, "/")
	assert.Equal(t, c.Secure, true)
	assert.Equal(t, c.SameSite, http.SameSiteLaxMode)

	_, _, body = ts.get(t, "/about")
	assert.StringContains(t, body, "<html lang='ru'>")
	assert.StringContains(t, body, "<option value='ru' lang='ru' selected>Русский</option>")
	assert.Equal(t, app.Models.Users.(*mocks.UserModel).Locale, "")

	for _, bad := range []string{"", "https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "about"} {
		_, header, _ := ts.postForm(t, "/language", url.Values{"csrf_token": {csrf}, "lang": {"en"}, "redirect": {bad}})
		assert.Equal(t, header.Get("Location"), "/")
	}

	code, _, _ = ts.postForm(t, "/language", url.Values{"csrf_token": {csrf}, "lang": {"de"}, "redirect": {"/"}})
	assert.Equal(t, code, http.StatusBadRequest)

	code, _, _ = ts.postForm(t, "/language", url.Values{"lang": {"ru"}, "redirect": {"/"}})
	assert.Equal(t, code, http.StatusBadRequest)
}

func TestLanguagePostSignedIn(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	csrf := ts.login(t)

	code, header, _ := ts.postForm(t, "/language", url.Values{
		"csrf_token": {csrf}, "lang": {"ru"}, "redirect": {"/account/rooms"},
	})
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/account/rooms")
	assert.Equal(t, langCookieOf(t, header).Value, "ru")
	assert.Equal(t, app.Models.Users.(*mocks.UserModel).Locale, "ru")

	// The account's choice outranks the cookie of another device.
	ts.Client().Jar.SetCookies(mustURL(t, ts.URL), []*http.Cookie{{Name: "lang", Value: "en", Path: "/"}})
	_, _, body := ts.get(t, "/about")
	assert.StringContains(t, body, "<html lang='ru'>")
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

var titleAndHeadingRX = regexp.MustCompile(`(?s)<title>([^<]+)</title>.*?<h2>([^<]+)</h2>`)

func TestAboutInBothLanguages(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	_, _, body := ts.get(t, "/about")
	en := titleAndHeadingRX.FindStringSubmatch(body)
	if en == nil {
		t.Fatal("the en page has no title or heading")
	}

	ts.Client().Jar.SetCookies(mustURL(t, ts.URL), []*http.Cookie{{Name: "lang", Value: "ru", Path: "/"}})
	_, _, body = ts.get(t, "/about")
	assert.StringContains(t, body, "/static/dist/i18n.ru.js?v=")
	ru := titleAndHeadingRX.FindStringSubmatch(body)
	if ru == nil || ru[1] == en[1] || ru[2] == en[2] {
		t.Errorf("title and heading %q in ru, %q in en: the ru page has the en text", ru, en)
	}
}
