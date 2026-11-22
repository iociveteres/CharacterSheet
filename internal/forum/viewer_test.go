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

// The viewer's ban stands from the query that loads the viewer: not lifted and not expired at the
// forum's now. An expired ban ends by itself.
func TestViewerBan(t *testing.T) {
	db := forumtest.NewDB(t)
	ctx := context.Background()
	id := forumtest.User(t, db, "Alice", at(0))
	moderator := newModerator(t, db, "moderator")
	host := &testHost{userID: id}
	f := newTestForum(t, db, host)
	ban := func(expires *time.Time, lifted bool) int {
		t.Helper()
		var banID int
		var liftedAt *time.Time
		if lifted {
			liftedAt = new(time.Time)
			*liftedAt = at(5)
		}
		err := db.QueryRow(ctx, `
			INSERT INTO forum_bans (user_id, moderator_id, reason, created_at, expires_at, lifted_at)
			VALUES ($1, $2, 'spam', $3, $4, $5) RETURNING id`, id, moderator, at(1), expires, liftedAt).Scan(&banID)
		assert.NilError(t, err)
		return banID
	}
	banOf := func(now time.Time) *Ban {
		t.Helper()
		f.now = func() time.Time { return now }
		v, called := viewerOf(t, f)
		assert.NilError(t, host.err)
		assert.Equal(t, called, true)
		return v.Ban
	}

	assert.Equal(t, banOf(at(2)) == nil, true)

	day := at(1).Add(24 * time.Hour)
	dayBan := ban(&day, false)
	got := banOf(at(2))
	if got == nil {
		t.Fatal("no ban a minute after it was given")
	}
	assert.Equal(t, got.ID, dayBan)
	assert.Equal(t, got.Reason, "spam")
	assert.Equal(t, got.CreatedAt.Equal(at(1)), true)
	assert.Equal(t, got.ExpiresAt.Equal(day), true)
	// Expired at its very end, without anything written.
	assert.Equal(t, banOf(day.Add(-time.Second)) != nil, true)
	assert.Equal(t, banOf(day) == nil, true)

	// A ban until lifted outlasts the day; once lifted, the day's ban stands again.
	forever := ban(nil, false)
	assert.Equal(t, banOf(at(2)).ID, forever)
	assert.Equal(t, banOf(day.Add(time.Hour)).ID, forever)
	_, err := db.Exec(ctx, `UPDATE forum_bans SET lifted_at = $2, lifted_by = $3 WHERE id = $1`, forever, at(3), moderator)
	assert.NilError(t, err)
	assert.Equal(t, banOf(at(4)).ID, dayBan)

	// Of two terms the longer.
	week := at(1).Add(7 * 24 * time.Hour)
	weekBan := ban(&week, false)
	assert.Equal(t, banOf(at(4)).ID, weekBan)
	ban(&week, true)
	assert.Equal(t, banOf(day.Add(time.Hour)).ID, weekBan)
}
