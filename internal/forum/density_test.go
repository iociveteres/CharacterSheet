package forum

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
)

// The menu "View ▾" works for a guest: the choice goes to the cookie, and the browser goes back.
func TestSetDensity(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)

	tests := []struct {
		name, density, redirect string
		wantLocation            string
		wantValue               string
		wantKept                bool
	}{
		{"compact", "compact", "/forum/", "/forum/", "compact", true},
		{"large back to a topic", "large", "/forum/topic/3?page=2", "/forum/topic/3?page=2", "large", true},
		{"normal drops the cookie", "normal", "/forum/", "/forum/", "", false},
		{"no redirect", "compact", "", "/forum/", "compact", true},
		{"redirect off the forum", "compact", "/account/view", "/forum/", "compact", true},
		{"redirect to another host", "compact", "/forum//evil.example", "/forum/", "compact", true},
		{"redirect with a backslash", "compact", "/forum/\\evil.example", "/forum/", "compact", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := h.post(t, f, "/forum/view/density", url.Values{"density": {tt.density}, "redirect": {tt.redirect}})
			assert.Equal(t, redirectedTo(t, rec), tt.wantLocation)
			cookies := rec.Result().Cookies()
			assert.Equal(t, len(cookies), 1)
			c := cookies[0]
			assert.Equal(t, c.Name, densityCookie)
			assert.Equal(t, c.Value, tt.wantValue)
			assert.Equal(t, c.Path, "/forum")
			assert.Equal(t, c.SameSite, http.SameSiteLaxMode)
			if tt.wantKept {
				assert.Equal(t, c.MaxAge, 365*24*60*60)
			} else if c.MaxAge >= 0 {
				t.Errorf("MaxAge %d, want the cookie deleted", c.MaxAge)
			}
		})
	}

	rec := h.post(t, f, "/forum/view/density", url.Values{"density": {"huge"}})
	assert.Equal(t, rec.Code, http.StatusBadRequest)
	assert.Equal(t, len(rec.Result().Cookies()), 0)
}

// Every forum page opens #forum with the class of the reader's density; without the cookie, or with
// one the forum does not know, it is "normal": no class.
func TestDensityClass(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	sections, err := f.sections(t.Context(), Viewer{})
	assert.NilError(t, err)
	section := fmt.Sprintf("/forum/section/%d", sections[0].ID)

	tests := []struct {
		cookie, wantOpen, wantCurrent string
	}{
		{"", `<div id="forum">`, "normal"},
		{"large", `<div id="forum" class="forum-large">`, "large"},
		{"compact", `<div id="forum" class="forum-compact">`, "compact"},
		{"normal", `<div id="forum">`, "normal"},
		{"huge", `<div id="forum">`, "normal"},
	}
	for _, tt := range tests {
		t.Run("cookie "+tt.cookie, func(t *testing.T) {
			for _, target := range []string{"/forum/", section} {
				body := getWithDensity(t, h, f, target, tt.cookie)
				if !strings.HasPrefix(body, tt.wantOpen) {
					t.Errorf("GET %s: page opens with %.60q, want %q", target, body, tt.wantOpen)
				}
			}
			// The menu of the home marks the current step, and only it.
			body := getWithDensity(t, h, f, "/forum/", tt.cookie)
			assert.Equal(t, strings.Count(body, `aria-current="true"`), 1)
			assert.Equal(t, strings.Contains(body, `class="forum-density-`+tt.wantCurrent+`" aria-current="true"`), true)
		})
	}
}

// The menu is on the home of a guest as of a signed-in user.
func TestDensityMenuForGuest(t *testing.T) {
	db := forumtest.NewDB(t)
	h := &testHost{}
	f := newTestForum(t, db, h)
	body := getWithDensity(t, h, f, "/forum/", "")
	assert.Equal(t, strings.Count(body, `action="/forum/view/density"`), len(densityChoices))
}

func getWithDensity(t *testing.T, h *testHost, f *Forum, target, cookie string) string {
	t.Helper()
	h.err, h.status, h.page, h.notFound = nil, 0, Page{}, false
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: densityCookie, Value: cookie})
	}
	f.Handler().ServeHTTP(httptest.NewRecorder(), req)
	if h.err != nil || h.status != http.StatusOK {
		t.Fatalf("GET %s: status %d, %v", target, h.status, h.err)
	}
	return string(h.page.Body)
}
