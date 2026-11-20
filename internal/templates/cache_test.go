package templates

import (
	"bytes"
	"html/template"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
	"charactersheet.iociveteres.net/internal/models"
)

func TestTemplateCacheContentByLanguage(t *testing.T) {
	files := fstest.MapFS{
		"html/base.html":            {Data: []byte(`{{define "base"}}<html lang='{{.Lang}}'>{{template "main" .}}</html>{{end}}`)},
		"html/partials/nav.html":    {Data: []byte(`{{define "nav"}}{{end}}`)},
		"html/pages/page.html":      {Data: []byte(`{{define "main"}}{{template "content/both" .}} {{template "content/enOnly" .}}{{end}}`)},
		"html/content/both.en.html": {Data: []byte(`Hello`)},
		"html/content/both.ru.html": {Data: []byte(`Привет`)},
		// No ru file: the ru page takes this one.
		"html/content/enOnly.en.html": {Data: []byte(`only {{.Lang}}`)},
	}
	cache, err := newTemplateCache(files)
	if err != nil {
		t.Fatal(err)
	}
	for lang, want := range map[string]string{
		"en": "<html lang='en'>Hello only en</html>",
		"ru": "<html lang='ru'>Привет only ru</html>",
	} {
		buf := new(bytes.Buffer)
		if err := cache[lang]["page.html"].ExecuteTemplate(buf, "base", &Data{Lang: lang}); err != nil {
			t.Fatal(err)
		}
		assert.Equal(t, buf.String(), want)
	}
}

func TestTemplateCacheContentWithoutEnglish(t *testing.T) {
	files := fstest.MapFS{
		"html/base.html":              {Data: []byte(`{{define "base"}}{{end}}`)},
		"html/partials/nav.html":      {Data: []byte(`{{define "nav"}}{{end}}`)},
		"html/pages/page.html":        {Data: []byte(`{{define "main"}}{{end}}`)},
		"html/content/ruOnly.ru.html": {Data: []byte(`Привет`)},
	}
	if _, err := newTemplateCache(files); err == nil {
		t.Error("content without an en file was accepted")
	}
}

// Every page of ui/html renders in every language with the least data its handler gives it.
func TestPagesRenderInEveryLanguage(t *testing.T) {
	cache, err := NewTemplateCache()
	assert.NilError(t, err)
	created := time.Date(2026, 1, 2, 15, 4, 0, 0, time.UTC)
	sheet := &models.CharacterSheet{CharacterName: "Kharn", CreatedAt: created, UpdatedAt: created}
	data := func(lang string) *Data {
		return &Data{
			Lang: lang,
			// The forms of internal/webapp read as fields; a map answers the same lookups.
			Form:                    map[string]any{"Errors": map[string]string{}, "NonFieldErrors": []string{}, "ID": 1, "Token": "token"},
			User:                    &models.User{Name: "user", CreatedAt: created},
			Room:                    &models.Room{ID: 1, Name: "room"},
			CurrentPlayerView:       &models.PlayerView{User: &models.User{Name: "user"}, Role: models.RoleGamemaster},
			MessagePage:             &models.MessagePage{},
			RoomsWithRole:           []*models.RoomWithRole{{Room: models.Room{ID: 1, CreatedAt: created}, UserRole: models.RoleGamemaster}},
			CharacterSheetSummaries: []*models.CharacterSheetSummary{{CharacterSheet: sheet, RoomID: 1, RoomName: "room"}},
			IsAuthenticated:         true,
			ShowIncidentNotice:      true,
			OnlineUsers:             2,
			Embedded:                &EmbeddedPage{Title: "title", Body: "<p>body</p>"},
		}
	}
	for lang, pages := range cache {
		for name, ts := range pages {
			t.Run(lang+"/"+name, func(t *testing.T) {
				// The route names are registered by internal/webapp, not here.
				ts.Funcs(template.FuncMap{"reverseRev": func(name string, _ ...string) string { return "/" + name }})
				buf := new(bytes.Buffer)
				assert.NilError(t, ts.ExecuteTemplate(buf, "base", data(lang)))
				if !strings.Contains(buf.String(), "<html lang='"+lang+"'>") {
					t.Errorf("no <html lang='%s'>", lang)
				}
			})
		}
	}
}

// The landing shows the slides recorded in the page language, the English ones where the
// language has none.
func TestHomeSlidesByLanguage(t *testing.T) {
	cache, err := NewTemplateCache()
	assert.NilError(t, err)
	for _, lang := range []string{"en", "ru"} {
		buf := new(bytes.Buffer)
		ts := cache[lang]["home.html"]
		ts.Funcs(template.FuncMap{"reverseRev": func(name string, _ ...string) string { return "/" + name }})
		assert.NilError(t, ts.ExecuteTemplate(buf, "base", &Data{Lang: lang}))
		for _, file := range []string{"1-layout-" + lang + "-light.webm?v=", "13-bestiary-" + lang + "-dark.webp?v="} {
			assert.StringContains(t, buf.String(), "/static/img/slides/"+file)
		}
	}
	assert.StringContains(t, slideURL("de", "2-character-info", "light", "webp"), "/static/img/slides/2-character-info-en-light.webp?v=")
}

// Only an embedded page, or a site page that asks with PageHead (the Account page), gets a
// viewport; only an embedded page names its canonical address. The other site pages are laid out
// for desktops.
func TestEmbeddedPageHead(t *testing.T) {
	cache, err := NewTemplateCache()
	assert.NilError(t, err)
	render := func(page string, data *Data) string {
		buf := new(bytes.Buffer)
		ts := cache["en"][page]
		ts.Funcs(template.FuncMap{"reverseRev": func(name string, _ ...string) string { return "/" + name }})
		assert.NilError(t, ts.ExecuteTemplate(buf, "base", data))
		head, _, _ := strings.Cut(buf.String(), "</head>")
		return head
	}

	head := render("about.html", &Data{Lang: "en"})
	for _, tag := range []string{`name="viewport"`, `rel="canonical"`, `name="robots"`} {
		if strings.Contains(head, tag) {
			t.Errorf("a site page has %s", tag)
		}
	}
	assert.StringContains(t, head, `name="description"`)

	head = render("embedded.html", &Data{Lang: "en", Embedded: &EmbeddedPage{
		Title: "Forum", Description: "About the forum", Canonical: "https://example.com/forum/",
		NoIndex: true, Styles: []string{"css/forum.css"}, Body: "<p>body</p>",
	}})
	assert.StringContains(t, head, `<meta name="viewport"`)
	assert.StringContains(t, head, `<link rel="canonical" href='https://example.com/forum/'>`)
	assert.StringContains(t, head, `<meta name="robots" content="noindex">`)
	assert.StringContains(t, head, `<meta name="description" content='About the forum'>`)
	assert.StringContains(t, head, `<title>Forum - Character Sheet</title>`)
	assert.StringContains(t, head, `href='/static/css/forum.css?v=`)

	head = render("about.html", &Data{Lang: "en", Head: &PageHead{Viewport: true, Styles: []string{"css/crop.css", "css/account.css"}}})
	assert.StringContains(t, head, `<meta name="viewport"`)
	assert.StringContains(t, head, `<meta name="description" content='`)
	crop, account := strings.Index(head, "/static/css/crop.css?v="), strings.Index(head, "/static/css/account.css?v=")
	if crop < 0 || account < crop || account < strings.Index(head, "/static/css/main.css?v=") {
		t.Errorf("the page's styles are not after main.css in their order: %d, %d", crop, account)
	}
	if strings.Contains(head, `rel="canonical"`) {
		t.Error("a site page names its canonical address")
	}
}

// An embedded page may widen <main>; the site pages keep the plain class.
func TestEmbeddedPageMainClass(t *testing.T) {
	cache, err := NewTemplateCache()
	assert.NilError(t, err)
	render := func(page string, data *Data) string {
		buf := new(bytes.Buffer)
		ts := cache["en"][page]
		ts.Funcs(template.FuncMap{"reverseRev": func(name string, _ ...string) string { return "/" + name }})
		assert.NilError(t, ts.ExecuteTemplate(buf, "base", data))
		return buf.String()
	}
	assert.StringContains(t, render("about.html", &Data{Lang: "en"}), `<main class="site-inner">`)
	assert.StringContains(t, render("embedded.html", &Data{Lang: "en", Embedded: &EmbeddedPage{Title: "Forum"}}),
		`<main class="site-inner">`)
	assert.StringContains(t, render("embedded.html", &Data{Lang: "en", Embedded: &EmbeddedPage{Title: "Forum", MainClass: "wide"}}),
		`<main class="site-inner wide">`)
}
