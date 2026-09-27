package webapp

import (
	"net/http"
	"net/url"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestRoomViewOfOthersRoom(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	_, _, body := ts.get(t, "/user/login")
	form := url.Values{}
	form.Add("email", "alice@example.com")
	form.Add("password", "pa$$word")
	form.Add("csrf_token", extractCSRFToken(t, body))
	ts.postForm(t, "/user/login", form)

	// Room 2 exists for nobody the mock knows; user 1 is not in it.
	for _, path := range []string{"/room/view/2", "/room/sheet/view/2/1"} {
		code, _, _ := ts.get(t, path)
		assert.Equal(t, code, http.StatusNotFound)
	}
}
