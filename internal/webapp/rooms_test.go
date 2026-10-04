package webapp

import (
	"encoding/json"
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
	for _, path := range []string{"/room/view/2", "/room/sheet/view/2/1", "/room/ws/2"} {
		code, _, _ := ts.get(t, path)
		assert.Equal(t, code, http.StatusNotFound)
	}
}

func TestRoomViewWithSheetOfOtherRoom(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	_, _, body := ts.get(t, "/user/login")
	form := url.Values{}
	form.Add("email", "alice@example.com")
	form.Add("password", "pa$$word")
	form.Add("csrf_token", extractCSRFToken(t, body))
	ts.postForm(t, "/user/login", form)

	// User 1 may view sheet 3, but it lives in room 2.
	code, header, _ := ts.get(t, "/room/sheet/view/1/3")
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/room/view/1")
}

func TestEncounterViewIsTheGamemasters(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	_, _, body := ts.get(t, "/user/login")
	form := url.Values{}
	form.Add("email", "alice@example.com")
	form.Add("password", "pa$$word")
	form.Add("csrf_token", extractCSRFToken(t, body))
	ts.postForm(t, "/user/login", form)

	code, _, body := ts.get(t, "/encounter/1")
	assert.Equal(t, code, http.StatusOK)
	var payload struct {
		Encounter struct{ ID int }
		Sheets    []struct{ SheetID string }
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatal(err)
	}
	assert.Equal(t, payload.Encounter.ID, 1)
	assert.Equal(t, len(payload.Sheets), 1)
	assert.Equal(t, payload.Sheets[0].SheetID, "1")

	// User 1 is no gamemaster of the room of encounter 2 (mocks.EncounterModel).
	code, _, _ = ts.get(t, "/encounter/2")
	assert.Equal(t, code, http.StatusForbidden)
	code, _, _ = ts.get(t, "/encounter/3")
	assert.Equal(t, code, http.StatusNotFound)
}
