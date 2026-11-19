package forum

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
)

// viewerOf runs a request through withView and returns what the handler got.
func viewerOf(t *testing.T, f *Forum) (Viewer, bool) {
	t.Helper()
	var got Viewer
	called := false
	f.withView(func(_ http.ResponseWriter, _ *http.Request, v view) {
		got, called = v.Viewer, true
	})(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/forum/", nil))
	return got, called
}

func TestGuestViewerWithoutQuery(t *testing.T) {
	// No pool: a guest must not reach the database.
	v, called := viewerOf(t, newTestForum(t, nil, &testHost{}))
	assert.Equal(t, called, true)
	assert.Equal(t, v, Viewer{})
	assert.Equal(t, v.SignedIn(), false)
}

func TestViewerLoaded(t *testing.T) {
	db := forumtest.NewDB(t)
	registered := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
	id := forumtest.User(t, db, "Alice", registered)
	host := &testHost{userID: id}
	f := newTestForum(t, db, host)

	v, called := viewerOf(t, f)
	assert.NilError(t, host.err)
	assert.Equal(t, called, true)
	assert.Equal(t, v.ID, id)
	assert.Equal(t, v.Name, "Alice")
	assert.Equal(t, v.RegisteredAt.Equal(registered), true)
	assert.Equal(t, v.SignedIn(), true)
	assert.Equal(t, v.Moderator, false)

	if _, err := db.Exec(context.Background(), `INSERT INTO forum_moderators (user_id) VALUES ($1)`, id); err != nil {
		t.Fatal(err)
	}
	v, _ = viewerOf(t, f)
	assert.Equal(t, v.Moderator, true)
}

func TestUnknownViewerIsServerError(t *testing.T) {
	host := &testHost{userID: 999}
	_, called := viewerOf(t, newTestForum(t, forumtest.NewDB(t), host))
	assert.Equal(t, called, false)
	assert.NotNilError(t, host.err)
}
