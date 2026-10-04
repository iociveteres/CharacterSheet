package webapp

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"github.com/gorilla/websocket"
)

// login signs user 1 in and returns a CSRF token for its requests.
func (ts *testServer) login(t *testing.T) string {
	t.Helper()
	_, _, body := ts.get(t, "/user/login")
	token := extractCSRFToken(t, body)
	form := url.Values{}
	form.Add("email", "alice@example.com")
	form.Add("password", "pa$$word")
	form.Add("csrf_token", token)
	ts.postForm(t, "/user/login", form)
	return token
}

// send makes a request as the bestiary client does: the CSRF token in a header.
func (ts *testServer) send(t *testing.T, method, path, contentType string, body io.Reader, token string) (int, http.Header, string) {
	t.Helper()
	req, err := http.NewRequest(method, ts.URL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("X-CSRF-Token", token)
	}
	rs, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Body.Close()
	b, err := io.ReadAll(rs.Body)
	if err != nil {
		t.Fatal(err)
	}
	return rs.StatusCode, rs.Header, string(b)
}

func TestBestiaryNeedsLogin(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	for _, path := range []string{"/bestiary", "/bestiary/collections"} {
		code, header, _ := ts.get(t, path)
		assert.Equal(t, code, http.StatusSeeOther)
		assert.Equal(t, header.Get("Location"), "/user/login")
	}
}

func TestBestiaryRequests(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	code, _, body := ts.get(t, "/bestiary")
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `<script id="bestiary-state" type="application/json">{"csrfToken":`)
	assert.StringContains(t, body, `{"kind":"black_crusade","label":"Black Crusade"}`)
	assert.StringContains(t, body, `<a href='/bestiary'>Bestiary</a>`)

	code, _, body = ts.get(t, "/bestiary/collections")
	assert.Equal(t, code, http.StatusOK)
	assert.StringContains(t, body, `"name":"Orks"`)

	tests := []struct {
		name, method, path, body string
		token                    string
		want                     int
	}{
		{"rename own", http.MethodPatch, "/bestiary/collections/1", `{"name":"Greenskins"}`, token, http.StatusOK},
		{"another user's collection", http.MethodPatch, "/bestiary/collections/2", `{"name":"Mine"}`, token, http.StatusForbidden},
		{"missing collection", http.MethodPatch, "/bestiary/collections/3", `{"name":"Mine"}`, token, http.StatusNotFound},
		{"bad JSON", http.MethodPatch, "/bestiary/collections/1", `{"name":`, token, http.StatusBadRequest},
		{"unknown field", http.MethodPatch, "/bestiary/collections/1", `{"owner":"gm"}`, token, http.StatusBadRequest},
		{"no CSRF token", http.MethodPatch, "/bestiary/collections/1", `{"name":"Greenskins"}`, "", http.StatusBadRequest},
		{"move into another user's collection", http.MethodPost, "/bestiary/creatures/1/move", `{"collectionId":2}`, token, http.StatusForbidden},
		{"export of another user's collection", http.MethodGet, "/bestiary/collections/2/export", ``, token, http.StatusForbidden},
		{"bad collection filter", http.MethodGet, "/bestiary/creatures?collection=x", ``, token, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, _, _ := ts.send(t, tt.method, tt.path, "application/json", strings.NewReader(tt.body), tt.token)
			assert.Equal(t, code, tt.want)
		})
	}

	t.Run("export", func(t *testing.T) {
		code, header, body := ts.send(t, http.MethodGet, "/bestiary/collections/1/export", "", nil, "")
		assert.Equal(t, code, http.StatusOK)
		assert.StringContains(t, header.Get("Content-Disposition"), `attachment; filename="Orks_`)
		assert.StringContains(t, body, `"format": "collection"`)
	})

	t.Run("quota", func(t *testing.T) {
		code, _, body := ts.send(t, http.MethodPost, "/bestiary/save", "application/json", strings.NewReader(`{"sheetId":1,"collectionId":1}`), token)
		assert.Equal(t, code, http.StatusRequestEntityTooLarge)
		assert.StringContains(t, body, `"code":"quota"`)
		assert.StringContains(t, body, "NPCs and creatures take 5.0 of 5 MB")
	})
}

func TestBestiaryUpload(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	upload := func(collection string, files map[string]string, order ...string) (int, string) {
		t.Helper()
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		for _, name := range order {
			part, err := w.CreateFormFile("files", name)
			if err != nil {
				t.Fatal(err)
			}
			part.Write([]byte(files[name]))
		}
		w.Close()
		code, _, body := ts.send(t, http.MethodPost, "/bestiary/collections/"+collection+"/upload", w.FormDataContentType(), &buf, token)
		return code, body
	}
	files := map[string]string{
		"boy.json":    `{"sheetKind": "black_crusade", "characterInfo": {"characterName": "Ork Boy"}}`,
		"notes.txt":   `not a sheet`,
		"orks.json":   `{"format": "collection", "version": 1, "name": "Orks", "creatures": [{"content": {}}, {"content": {}}]}`,
		"gretch.json": `{"characterInfo": {"characterName": "Gretchin"}}`,
	}

	code, _ := upload("2", files, "boy.json")
	assert.Equal(t, code, http.StatusForbidden)

	// Two creatures fill the quota of the mock: the collection file does not
	// fit, and the file after it is not taken.
	code, body := upload("1", files, "boy.json", "notes.txt", "orks.json", "gretch.json")
	assert.Equal(t, code, http.StatusOK)
	var results []struct {
		File, Error, Message string
		Added                int
	}
	if err := json.Unmarshal([]byte(body), &results); err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, len(results), 3)
	assert.Equal(t, results[0].File, "boy.json")
	assert.Equal(t, results[0].Added, 1)
	assert.Equal(t, results[1].Error, "invalid")
	assert.Equal(t, results[2].Error, "quota")
	assert.StringContains(t, results[2].Message, "NPCs and creatures take")

	// A new creature counts against the same quota.
	newCreature := func() (int, string) {
		code, _, body := ts.send(t, http.MethodPost, "/bestiary/collections/1/creatures", "application/json", strings.NewReader(`{"kind":"black_crusade"}`), token)
		return code, body
	}
	code, _ = newCreature()
	assert.Equal(t, code, http.StatusCreated)
	code, body = newCreature()
	assert.Equal(t, code, http.StatusRequestEntityTooLarge)
	assert.StringContains(t, body, `"code":"quota"`)
}

func TestSharedCollectionRequests(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	tests := []struct {
		name, method, path, body string
		want                     int
	}{
		{"make public", http.MethodPatch, "/bestiary/collections/1", `{"visibility":"public"}`, http.StatusOK},
		{"make private", http.MethodPatch, "/bestiary/collections/1", `{"visibility":"private"}`, http.StatusOK},
		{"unknown visibility", http.MethodPatch, "/bestiary/collections/1", `{"visibility":"everyone"}`, http.StatusBadRequest},
		{"visibility by link", http.MethodPatch, "/bestiary/collections/1", `{"visibility":"link"}`, http.StatusBadRequest},
		{"make the default collection public", http.MethodPatch, "/bestiary/collections/7", `{"visibility":"public"}`, http.StatusBadRequest},
		{"delete the default collection", http.MethodDelete, "/bestiary/collections/7", ``, http.StatusBadRequest},
		{"get an own collection", http.MethodGet, "/bestiary/collections/1", ``, http.StatusOK},
		{"get a public collection", http.MethodGet, "/bestiary/collections/2", ``, http.StatusOK},
		{"get a private collection", http.MethodGet, "/bestiary/collections/4", ``, http.StatusNotFound},
		{"subscribe to a public collection", http.MethodPut, "/bestiary/subscriptions/2", ``, http.StatusOK},
		{"subscribe to an own collection", http.MethodPut, "/bestiary/subscriptions/1", ``, http.StatusBadRequest},
		{"subscribe to a private collection", http.MethodPut, "/bestiary/subscriptions/4", ``, http.StatusNotFound},
		{"unsubscribe", http.MethodDelete, "/bestiary/subscriptions/2", ``, http.StatusNoContent},
		{"subscription without an id", http.MethodPut, "/bestiary/subscriptions/x", ``, http.StatusNotFound},
		{"new creature", http.MethodPost, "/bestiary/collections/1/creatures", `{"kind":"black_crusade"}`, http.StatusCreated},
		{"new creature of an unknown kind", http.MethodPost, "/bestiary/collections/1/creatures", `{"kind":"dnd"}`, http.StatusBadRequest},
		{"new creature without a kind", http.MethodPost, "/bestiary/collections/1/creatures", `{}`, http.StatusBadRequest},
		{"new creature in a public collection", http.MethodPost, "/bestiary/collections/2/creatures", `{"kind":"black_crusade"}`, http.StatusForbidden},
		{"new creature in a private collection", http.MethodPost, "/bestiary/collections/4/creatures", `{"kind":"black_crusade"}`, http.StatusNotFound},
		// The routes of links and bookmarks are gone.
		{"open a collection", http.MethodPost, "/bestiary/collections/2/open", ``, http.StatusNotFound},
		{"change a link", http.MethodPost, "/bestiary/collections/1/link", ``, http.StatusNotFound},
		{"follow a link", http.MethodGet, "/bestiary/link/abc", ``, http.StatusNotFound},
		{"forget a bookmark", http.MethodDelete, "/bestiary/bookmarks/2", ``, http.StatusNotFound},
		{"post to a collection", http.MethodPost, "/bestiary/collections/2", ``, http.StatusMethodNotAllowed},
		{"catalog", http.MethodGet, "/bestiary/catalog?q=horde&sort=old&after=1767225600000000-7", ``, http.StatusOK},
		{"catalog sorted by nothing known", http.MethodGet, "/bestiary/catalog?sort=name", ``, http.StatusBadRequest},
		{"catalog after a broken cursor", http.MethodGet, "/bestiary/catalog?after=50", ``, http.StatusBadRequest},
		{"copy into a collection", http.MethodPost, "/bestiary/creatures/1/copy", `{"collectionId":1}`, http.StatusCreated},
		{"copy into a new collection", http.MethodPost, "/bestiary/creatures/1/copy", `{"newCollection":"Fresh"}`, http.StatusCreated},
		{"move into a new collection", http.MethodPost, "/bestiary/creatures/1/move", `{"newCollection":"Fresh"}`, http.StatusBadRequest},
		{"creatures of a public collection", http.MethodGet, "/bestiary/creatures?collection=2", ``, http.StatusOK},
		{"creatures of a private collection", http.MethodGet, "/bestiary/creatures?collection=4", ``, http.StatusNotFound},
		{"rename a private collection", http.MethodPatch, "/bestiary/collections/4", `{"name":"Mine"}`, http.StatusNotFound},
		{"export of another user's public collection", http.MethodGet, "/bestiary/collections/2/export", ``, http.StatusForbidden},
		{"export of another user's private collection", http.MethodGet, "/bestiary/collections/4/export", ``, http.StatusNotFound},
		// A creature of a public collection exports as any sheet the user can view.
		{"export of a public creature", http.MethodGet, "/sheet/export/4", ``, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, _, _ := ts.send(t, tt.method, tt.path, "application/json", strings.NewReader(tt.body), token)
			assert.Equal(t, code, tt.want)
		})
	}

	_, _, body := ts.get(t, "/bestiary/catalog")
	assert.StringContains(t, body, `"rows":[{"id":2,"name":"Horde","owner":"bob"`)
	assert.StringContains(t, body, `"next":null`)

	_, _, body = ts.send(t, http.MethodPut, "/bestiary/subscriptions/2", "", nil, token)
	assert.StringContains(t, body, `"subscribed":true`)
	_, _, body = ts.get(t, "/bestiary/collections/7")
	assert.StringContains(t, body, `"default":true`)
	_, _, body = ts.send(t, http.MethodPost, "/bestiary/collections/7/creatures", "application/json", strings.NewReader(`{"kind":"black_crusade"}`), token)
	assert.StringContains(t, body, `"collectionId":7`)
	assert.StringContains(t, body, `"name":"New creature"`)
}

// dialBestiary opens the /bestiary socket of the signed-in user.
func (ts *testServer) dialBestiary(t *testing.T) *websocket.Conn {
	t.Helper()
	t.Setenv("BASE_URL", ts.URL)
	roots := x509.NewCertPool()
	roots.AddCert(ts.Certificate())
	dialer := websocket.Dialer{TLSClientConfig: &tls.Config{RootCAs: roots}}
	u, _ := url.Parse(ts.URL)
	header := http.Header{"Origin": {ts.URL}}
	for _, c := range ts.client.Jar.Cookies(u) {
		header.Add("Cookie", c.String())
	}
	conn, _, err := dialer.Dial("wss"+strings.TrimPrefix(ts.URL, "https")+"/bestiary/ws", header)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

// The tabs of the bestiary hear of the creatures deleted over HTTP.
func TestBestiaryChangesReachOpenPages(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	// No page is open: no hub is made for the change.
	code, _, _ := ts.send(t, http.MethodDelete, "/bestiary/creatures/1", "", nil, token)
	assert.Equal(t, code, http.StatusNoContent)
	assert.Equal(t, len(app.WSServer.BestiaryHubs), 0)

	conn := ts.dialBestiary(t)
	// The page registers asynchronously; a change sent before it is lost.
	for deadline := time.Now().Add(5 * time.Second); app.WSServer.TotalOnlineUsers() == 0; time.Sleep(5 * time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatal("the page did not register")
		}
	}
	read := func() string {
		t.Helper()
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, msg, err := conn.ReadMessage()
		if err != nil {
			t.Fatal(err)
		}
		return string(msg)
	}

	code, _, _ = ts.send(t, http.MethodDelete, "/bestiary/creatures/1", "", nil, token)
	assert.Equal(t, code, http.StatusNoContent)
	assert.Equal(t, read(), `{"type":"creaturesDeleted","ids":[1]}`)

	code, _, _ = ts.send(t, http.MethodDelete, "/bestiary/collections/1", "", nil, token)
	assert.Equal(t, code, http.StatusNoContent)
	assert.Equal(t, read(), `{"type":"creaturesDeleted","ids":[1]}`)
}
