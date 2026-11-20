package webapp

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestSheetView(t *testing.T) {
	// Create a new instance of our application struct which uses the mocked
	// dependencies.
	app := newTestApplication(t)
	// Establish a new test server for running end-to-end tests.
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	_, _, body := ts.get(t, "/user/login")
	csrfToken := extractCSRFToken(t, body)
	form := url.Values{}
	form.Add("email", "alice@example.com")
	form.Add("password", "pa$$word")
	form.Add("csrf_token", csrfToken)
	ts.postForm(t, "/user/login", form)
	// Set up some table-driven tests to check the responses sent by our
	// application for different URLs.
	tests := []struct {
		name     string
		urlPath  string
		wantCode int
		wantBody string
	}{
		{
			name:     "Valid ID",
			urlPath:  "/sheet/view/1",
			wantCode: http.StatusOK,
			wantBody: `"sheetId":"1","kind":"black_crusade","canEdit":true,"content":{`,
		},
		{
			name:     "Non-existent ID",
			urlPath:  "/sheet/view/2",
			wantCode: http.StatusNotFound,
		},
		{
			name:     "Negative ID",
			urlPath:  "/sheet/view/-1",
			wantCode: http.StatusNotFound,
		},
		{
			name:     "Decimal ID",
			urlPath:  "/sheet/view/1.23",
			wantCode: http.StatusNotFound,
		},
		{
			name:     "String ID",
			urlPath:  "/sheet/view/foo",
			wantCode: http.StatusNotFound,
		},
		{
			name:     "Empty ID",
			urlPath:  "/sheet/view/",
			wantCode: http.StatusNotFound,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, _, body := ts.get(t, tt.urlPath)
			assert.Equal(t, code, tt.wantCode)
			if tt.wantBody != "" {
				assert.StringContains(t, body, tt.wantBody)
			}
		})
	}
}

// The import of a sheet larger than the server takes answers 413, whether the
// body says its length or not, and so does content the database refuses.
func TestSheetImportSize(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()
	token := ts.login(t)

	sheet := func(padding int) string {
		return `{"characterInfo":{"characterName":"Kharn"},"characteristics":{},"skillsLeft":{},"skillsRight":{},` +
			`"padding":"` + strings.Repeat("x", padding) + `"}`
	}
	// Not a sheet: read whole, it would answer 400.
	junk := strings.Repeat("x", maxSheetBody)
	for name, tt := range map[string]struct {
		file string
		// The token goes in the form, as the room page sends it, unless the
		// body is sent with no length: then in the header.
		chunked bool
		want    int
	}{
		"small":                         {sheet(0), false, http.StatusOK},
		"over the body limit":           {junk, false, http.StatusRequestEntityTooLarge},
		"over the body limit, chunked":  {junk, true, http.StatusRequestEntityTooLarge},
		"content over the stored limit": {sheet(600 << 10), false, http.StatusRequestEntityTooLarge},
	} {
		t.Run(name, func(t *testing.T) {
			fields := map[string]string{"room_id": "1"}
			if !tt.chunked {
				fields["csrf_token"] = token
			}
			contentType, body := multipartFiles(t, fields, "sheet_file", [][2]string{{"kharn.json", tt.file}})
			var reader io.Reader = body
			header := ""
			if tt.chunked {
				// Hiding the buffer's length makes the client send it chunked.
				reader, header = io.MultiReader(bytes.NewReader(body.Bytes())), token
			}
			code, _, _ := ts.send(t, http.MethodPost, "/sheet/import", contentType, reader, header)
			assert.Equal(t, code, tt.want)
		})
	}
}
