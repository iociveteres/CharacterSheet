package webapp

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/forum"
	"charactersheet.iociveteres.net/internal/forum/forumtest"
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
		assert.StringContains(t, body, `<a href='/forum/'>`)

		// The sections in order of position, the one added above first.
		items := strings.Split(body, `class="forum-section"`)
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

	code, _, _ := ts.postForm(t, "/forum/", url.Values{})
	assert.Equal(t, code, http.StatusBadRequest)
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
