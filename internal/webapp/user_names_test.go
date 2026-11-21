package webapp

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

// putName renames the signed-in user and returns the status and the answer.
func (ts *testServer) putName(t *testing.T, name, token string) (int, renameAnswer) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"name": name})
	if err != nil {
		t.Fatal(err)
	}
	code, _, resp := ts.send(t, http.MethodPut, "/account/name", "application/json", strings.NewReader(string(body)), token)
	var answer renameAnswer
	if err := json.Unmarshal([]byte(resp), &answer); err != nil {
		t.Fatalf("%d %q: %v", code, resp, err)
	}
	return code, answer
}

func TestAccountNamePut(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)
	users := app.Models.Users.(*mocks.UserModel)
	users.History = []models.NameChange{{Name: "Alice", ChangedAt: time.Now()}}

	// Stored trimmed; the answer carries the avatar's letter and the former names.
	code, answer := ts.putName(t, "  ёжик  ", token)
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, users.Name, "ёжик")
	assert.Equal(t, answer.Name, "ёжик")
	assert.Equal(t, answer.Initial, "Ё")
	assert.Equal(t, len(answer.Former), 1)
	assert.Equal(t, answer.Former[0].Name, "Alice")

	// 64 letters are counted as letters, not bytes.
	code, _ = ts.putName(t, strings.Repeat("я", maxNameChars), token)
	assert.Equal(t, code, http.StatusOK)

	refused := map[string]string{
		"taken, in another case": strings.ToLower(mocks.TakenName),
		"blank":                  "   ",
		"too long":               strings.Repeat("я", maxNameChars+1),
	}
	for name, value := range refused {
		t.Run(name, func(t *testing.T) {
			before := users.Name
			code, answer := ts.putName(t, value, token)
			assert.Equal(t, code, http.StatusUnprocessableEntity)
			if answer.Errors["name"] == "" {
				t.Errorf("no error of the name field: %+v", answer)
			}
			assert.Equal(t, users.Name, before)
		})
	}
}

func TestAccountNamePutNeedsSignIn(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.csrfOf(t, "/user/login")

	code, _, _ := ts.send(t, http.MethodPut, "/account/name", "application/json", strings.NewReader(`{"name":"Bob"}`), token)
	if code == http.StatusOK {
		t.Error("a guest renamed someone")
	}
	assert.Equal(t, app.Models.Users.(*mocks.UserModel).Name, "")
}

// renamePerUser: 10 renames an hour, refused ones counted; the 11th gets the error of the field.
func TestAccountNamePutLimit(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	for i := range 10 {
		name := "Bob"
		if i%2 == 1 {
			name = mocks.TakenName
		}
		code, _ := ts.putName(t, name, token)
		if code == http.StatusTooManyRequests {
			t.Fatalf("rename %d refused by the limit", i+1)
		}
	}
	code, answer := ts.putName(t, "Carol", token)
	assert.Equal(t, code, http.StatusTooManyRequests)
	if answer.Errors["name"] == "" {
		t.Errorf("no error of the name field: %+v", answer)
	}
	assert.Equal(t, app.Models.Users.(*mocks.UserModel).Name, "Bob")
}

// The Account page gives its script the name and the former ones.
func TestAccountViewFormerNames(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	ts.login(t)
	app.Models.Users.(*mocks.UserModel).History = []models.NameChange{
		{Name: "Bobby", ChangedAt: time.Now()},
		{Name: "Robert", ChangedAt: time.Now().Add(-time.Hour)},
	}

	code, _, body := ts.get(t, "/account/view")
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `id="account-name"`)
	assert.StringContains(t, body, `data-name="Alice"`)
	assert.StringContains(t, body, `&#34;name&#34;:&#34;Bobby&#34;`)
	assert.StringContains(t, body, `&#34;name&#34;:&#34;Robert&#34;`)
	// Without the script: ▾ and its panel, the latest first.
	assert.StringContains(t, body, `<details class="former-names">`)
	if bobby, robert := strings.Index(body, `<span class="former-name">Bobby</span>`), strings.Index(body, `<span class="former-name">Robert</span>`); bobby < 0 || robert < bobby {
		t.Errorf("former names not listed latest first: Bobby at %d, Robert at %d", bobby, robert)
	}
}
