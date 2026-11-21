package webapp

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

func loginForm(token, email string) url.Values {
	return url.Values{"email": {email}, "password": {"wrong password"}, "csrf_token": {token}}
}

// Logins from one address within a minute: the burst of 5 is answered, the
// rest up to the 11th get the login page again with 429, until a token
// comes back; other addresses are not held back.
func TestLoginLimitPerAddress(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	_, _, body := ts.get(t, "/user/login")
	token := extractCSRFToken(t, body)

	for i := range 11 {
		code, header, body := ts.postFormFrom(t, "/user/login", "10.1.0.1", loginForm(token, fmt.Sprintf("user%d@example.com", i)))
		if i < 5 {
			assert.Equal(t, code, http.StatusUnprocessableEntity)
			continue
		}
		assert.Equal(t, code, http.StatusTooManyRequests)
		// A token every 6 seconds: 10 a minute.
		assert.Equal(t, header.Get("Retry-After"), "6")
		assert.StringContains(t, body, "Too many attempts. Try again in a minute.")
		assert.StringContains(t, body, fmt.Sprintf("value='user%d@example.com'", i))
		// The page is shown with a token, so the form can be sent again.
		extractCSRFToken(t, body)
	}

	code, _, _ := ts.postFormFrom(t, "/user/login", "10.1.0.2", loginForm(token, "other@example.com"))
	assert.Equal(t, code, http.StatusUnprocessableEntity)
}

// One email from many addresses: the 6th within a minute is refused, however
// the email is written.
func TestLoginLimitPerEmail(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	_, _, body := ts.get(t, "/user/login")
	token := extractCSRFToken(t, body)

	emails := []string{"alice@example.com", "Alice@Example.com", " alice@example.com", "ALICE@EXAMPLE.COM", "alice@example.com"}
	for i, email := range emails {
		code, _, _ := ts.postFormFrom(t, "/user/login", fmt.Sprintf("10.2.0.%d", i+1), loginForm(token, email))
		assert.Equal(t, code, http.StatusUnprocessableEntity)
	}
	code, _, _ := ts.postFormFrom(t, "/user/login", "10.2.0.9", loginForm(token, "alice@example.com"))
	assert.Equal(t, code, http.StatusTooManyRequests)
}

var csrfInputRX = regexp.MustCompile(`name='csrf_token' value='[^']*'`)

// A refused password reset reads the same for an email with an account and
// one without, and so do the answers before it.
func TestPasswordResetLimitDoesNotTellEmailsApart(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	_, _, body := ts.get(t, "/user/password/request-reset")
	token := extractCSRFToken(t, body)

	answers := map[string][]string{}
	for _, email := range []string{"alice@example.com", "nobody@example.com"} {
		for i := range 4 {
			// Each from its own address: only the limit per email is reached.
			addr := fmt.Sprintf("10.3.%d.%d", len(answers), i+1)
			code, header, body := ts.postFormFrom(t, "/user/password/request-reset", addr, url.Values{"email": {email}, "csrf_token": {token}})
			// The page shows the email it was sent, and a token of its own.
			body = strings.ReplaceAll(csrfInputRX.ReplaceAllString(body, ""), email, "EMAIL")
			answers[email] = append(answers[email], fmt.Sprintf("%d %s %s", code, header.Get("Location"), body))
		}
	}

	alice, nobody := answers["alice@example.com"], answers["nobody@example.com"]
	for i := range alice {
		if alice[i] != nobody[i] {
			t.Errorf("answer %d differs:\n%s\n----\n%s", i+1, alice[i], nobody[i])
		}
	}
	assert.StringContains(t, alice[3], "429")
	assert.StringContains(t, alice[3], "Too many attempts. Try again in")
}

// Sheet imports and the bestiary and encounter uploads share a limit of 20 a
// minute per user, answered with the status alone.
func TestUploadsLimitPerUser(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	paths := []string{"/sheet/import", "/encounters/load", "/encounter/1/npcs", "/bestiary/collections/1/upload"}
	for i := range 20 {
		// No file: the handler refuses it, but it is counted.
		code, _, _ := ts.send(t, http.MethodPost, paths[i%len(paths)], "", nil, token)
		if code == http.StatusTooManyRequests {
			t.Fatalf("upload %d refused within the limit", i+1)
		}
	}
	code, header, body := ts.send(t, http.MethodPost, "/bestiary/collections/1/upload", "", nil, token)
	assert.Equal(t, code, http.StatusTooManyRequests)
	assert.Equal(t, header.Get("Retry-After"), "3")
	assert.StringContains(t, body, "Too Many Requests")
}

// The route of e2e gives the limited clients their burst back; without -dev there is none.
func TestDevLimitsReset(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	code, _, _ := ts.postForm(t, "/dev/limits/reset", url.Values{})
	assert.Equal(t, code, http.StatusNotFound)
	ts.Close()

	app = newTestApplication(t)
	app.Dev = true
	ts = newTestServer(t, app.Routes())
	defer ts.Close()
	_, _, body := ts.get(t, "/user/login")
	token := extractCSRFToken(t, body)
	login := func() int {
		code, _, _ := ts.postFormFrom(t, "/user/login", "10.4.0.1", loginForm(token, "alice@example.com"))
		return code
	}
	for range 5 {
		login()
	}
	assert.Equal(t, login(), http.StatusTooManyRequests)

	code, _, _ = ts.postForm(t, "/dev/limits/reset", url.Values{})
	assert.Equal(t, code, http.StatusNoContent)
	assert.Equal(t, login(), http.StatusUnprocessableEntity)
}
