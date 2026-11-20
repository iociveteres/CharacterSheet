package webapp

import (
	"bytes"
	"context"
	"errors"
	"html"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/models/mocks"
)

func TestForumHomeForGuest(t *testing.T) {
	app := newTestApplication(t)
	db := forumtest.NewDB(t)
	var err error
	app.Forum, err = forum.New(db, "https://example.com", app.ForumHost())
	if err != nil {
		t.Fatal(err)
	}
	// Above the starting sections of the migration.
	_, err = db.Exec(context.Background(), `
		INSERT INTO forum_sections (name, description, position)
		VALUES ('Tavern & dice', 'Anything <off topic>', 0)`)
	if err != nil {
		t.Fatal(err)
	}
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	for _, lang := range []string{"en", "ru"} {
		u, _ := url.Parse(ts.URL)
		ts.Client().Jar.SetCookies(u, []*http.Cookie{{Name: "lang", Value: lang}})
		code, _, body := ts.get(t, "/forum/")
		assert.Equal(t, code, http.StatusOK)
		assert.StringContains(t, body, "<html lang='"+lang+"'>")
		// Inside the site layout, with the head of an embedded page.
		assert.StringContains(t, body, `<header class="site-inner">`)
		assert.StringContains(t, body, `<nav class="site-wide">`)
		assert.StringContains(t, body, `<meta name="viewport"`)
		assert.StringContains(t, body, `<link rel="canonical" href='https://example.com/forum/'>`)
		assert.StringContains(t, body, `href='/static/css/forum.css?v=`)
		assert.StringContains(t, body, `<a href='/forum/' data-live-prefix='/forum/'>`)

		// The sections in order of position, the one added above first.
		items := strings.Split(body, `<li class="forum-row`)
		assert.Equal(t, len(items), 1+6)
		assert.StringContains(t, items[1], "Tavern &amp; dice")
		assert.StringContains(t, items[1], "Anything &lt;off topic&gt;")
	}
}

func TestForumWithoutSlash(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	code, header, _ := ts.get(t, "/forum")
	assert.Equal(t, code, http.StatusMovedPermanently)
	assert.Equal(t, header.Get("Location"), "/forum/")
}

func TestForumPostWithoutCSRFToken(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	for _, path := range []string{"/forum/", "/forum/preview", "/forum/read"} {
		code, _, _ := ts.postForm(t, path, url.Values{"body": {"text"}})
		assert.Equal(t, code, http.StatusBadRequest)
	}
}

type panickingForum struct{}

func (panickingForum) Handler() http.Handler {
	return http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("forum") })
}

func (panickingForum) UnreadNotifications(context.Context, int) (int, error) { return 0, nil }

func TestForumPanicLeavesSiteServing(t *testing.T) {
	app := newTestApplication(t)
	app.Forum = panickingForum{}
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	code, _, _ := ts.get(t, "/forum/")
	assert.Equal(t, code, http.StatusInternalServerError)
	code, _, _ = ts.get(t, "/about")
	assert.Equal(t, code, http.StatusOK)
}

func TestForumUnknownAddress(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	_, siteHeader, siteBody := ts.get(t, "/no-such-page")
	for _, path := range []string{"/forum/no-such-page", "/forum/topic/1/no"} {
		code, header, body := ts.get(t, path)
		assert.Equal(t, code, http.StatusNotFound)
		assert.Equal(t, body, siteBody)
		assert.Equal(t, header.Get("Content-Type"), siteHeader.Get("Content-Type"))
	}
}

// TestForumLoginComesBack: the forum's link to sign in and reply brings the guest back to it.
func TestForumLoginComesBack(t *testing.T) {
	app := newTestApplication(t)
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	code, header, _ := ts.get(t, "/forum/topic/1/reply")
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/user/login")

	_, _, body := ts.get(t, "/user/login")
	form := url.Values{}
	form.Add("email", "alice@example.com")
	form.Add("password", "pa$$word")
	form.Add("csrf_token", extractCSRFToken(t, body))
	code, header, _ = ts.postForm(t, "/user/login", form)
	assert.Equal(t, code, http.StatusSeeOther)
	assert.Equal(t, header.Get("Location"), "/forum/topic/1/reply")
}

// countingForum answers the nav counter with n or err and counts the questions.
type countingForum struct {
	ForumService
	n     int
	err   error
	asked int
}

func (f *countingForum) UnreadNotifications(context.Context, int) (int, error) {
	f.asked++
	return f.n, f.err
}

func badges(body string) []string {
	var found []string
	for _, part := range strings.Split(body, `<span class="nav-badge"`)[1:] {
		start := strings.Index(part, ">") + 1
		// html/template writes "+" as "&#43;".
		found = append(found, html.UnescapeString(part[start:start+strings.Index(part[start:], "<")]))
	}
	return found
}

// The room is drawn without the nav, so it never asks the forum for the counter; a page of the
// site does, once.
func TestRoomDoesNotAskForum(t *testing.T) {
	app := newTestApplication(t)
	forum := &countingForum{ForumService: app.Forum, n: 3}
	app.Forum = forum
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	ts.get(t, "/about")
	assert.Equal(t, forum.asked, 0) // a guest
	ts.login(t)
	forum.asked = 0
	code, _, body := ts.get(t, "/room/view/1")
	assert.Equal(t, code, http.StatusOK)
	assert.Equal(t, forum.asked, 0)
	assert.Equal(t, len(badges(body)), 0)

	_, _, body = ts.get(t, "/about")
	assert.Equal(t, forum.asked, 1)
	assert.Equal(t, strings.Join(badges(body), ","), "3")
}

// A failing counter leaves the page served, without the counter, and goes to the error log.
func TestForumCounterFailureServesPage(t *testing.T) {
	app := newTestApplication(t)
	var log bytes.Buffer
	app.ErrorLog.SetOutput(&log)
	app.Forum = &countingForum{ForumService: app.Forum, n: 0, err: errors.New("no forum today")}
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	ts.login(t)
	log.Reset()
	for _, path := range []string{"/about", "/account/view"} {
		code, _, body := ts.get(t, path)
		assert.Equal(t, code, http.StatusOK)
		assert.StringContains(t, body, `<a href='/forum/' data-live-prefix='/forum/'>`)
		assert.Equal(t, len(badges(body)), 0)
	}
	assert.Equal(t, strings.Count(log.String(), "no forum today"), 2)
}

// The counter is the number up to 9, "9+" past it, nothing at zero.
func TestForumCounter(t *testing.T) {
	app := newTestApplication(t)
	forum := &countingForum{ForumService: app.Forum}
	app.Forum = forum
	ts := newTestServer(t, app.Routes())
	defer ts.Close()

	ts.login(t)
	for n, want := range map[int]string{0: "", 1: "1", 9: "9", 10: "9+", 1500: "9+"} {
		forum.n = n
		_, _, body := ts.get(t, "/about")
		assert.Equal(t, strings.Join(badges(body), ","), want)
	}
}

func TestForumHostAvatars(t *testing.T) {
	app := newTestApplication(t)
	avatars := app.Models.Avatars.(*mocks.AvatarModel)
	ctx := context.Background()
	hash, err := avatars.Put(ctx, 1, "image/webp", []byte("image"))
	assert.NilError(t, err)
	until := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	assert.NilError(t, avatars.Remove(ctx, 2, &models.AvatarLock{Until: &until, Reason: "advert", ModeratorID: 1}))
	host := app.ForumHost()

	// The URL GET /avatar/:hash serves; a user without an avatar is not in the map.
	urls, err := host.Avatars(ctx, []int{1, 2})
	assert.NilError(t, err)
	assert.Equal(t, len(urls), 1)
	assert.Equal(t, urls[1], "/avatar/"+hash)

	state, err := host.AvatarState(ctx, 1)
	assert.NilError(t, err)
	assert.Equal(t, state.URL, "/avatar/"+hash)
	assert.Equal(t, state.Lock == nil, true)

	state, err = host.AvatarState(ctx, 2)
	assert.NilError(t, err)
	assert.Equal(t, state.URL, "")
	assert.Equal(t, state.Lock.UserID, 2)
	assert.Equal(t, state.Lock.Until.Equal(until), true)
	assert.Equal(t, state.Lock.Reason, "advert")
	assert.Equal(t, state.Lock.ModeratorID, 1)
}

// The forum removes and unlocks the site's avatar through its host (extras/plan.md, block 6): the
// model does it, the lock keeps who and why, and the notification leads to the Account page.
func TestForumHostRemovesAvatar(t *testing.T) {
	app := newTestApplication(t)
	avatars := app.Models.Avatars.(*mocks.AvatarModel)
	ctx := context.Background()
	_, err := avatars.Put(ctx, 1, "image/webp", []byte("image"))
	assert.NilError(t, err)
	_, err = avatars.Put(ctx, 2, "image/webp", []byte("other"))
	assert.NilError(t, err)
	host := app.ForumHost()

	until := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	assert.NilError(t, host.RemoveAvatar(ctx, 1, &forum.AvatarLock{Until: &until, Reason: "advert", ModeratorID: 3}))
	assert.NilError(t, host.RemoveAvatar(ctx, 2, nil))
	urls, err := host.Avatars(ctx, []int{1, 2})
	assert.NilError(t, err)
	assert.Equal(t, len(urls), 0)

	locks, err := host.AvatarLocks(ctx)
	assert.NilError(t, err)
	assert.Equal(t, len(locks), 1)
	assert.Equal(t, locks[0].UserID, 1)
	assert.Equal(t, locks[0].Until.Equal(until), true)
	assert.Equal(t, locks[0].Reason, "advert")
	assert.Equal(t, locks[0].ModeratorID, 3)

	assert.NilError(t, host.LiftAvatarLock(ctx, 1))
	locks, err = host.AvatarLocks(ctx)
	assert.NilError(t, err)
	assert.Equal(t, len(locks), 0)

	// The address comes from the site's routes, registered when the app starts.
	app.Routes()
	assert.Equal(t, host.AccountURL(), "/account/view#avatar")
}
