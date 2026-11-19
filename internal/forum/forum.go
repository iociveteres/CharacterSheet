// Package forum is the site's forum. It imports no other feature of the app and neither webapp
// nor templates: the app hands it a pool, the site address and a Host (_prd/forum/plan.md).
package forum

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"html/template"
	"net/http"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/util"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Host is what the app does for the forum: sessions, CSRF, flash and the site layout stay
// on its side.
type Host interface {
	// UserID is the signed-in user, false for a guest.
	UserID(r *http.Request) (int, bool)
	// CSRFToken goes into the csrf_token field of a form, as on the site.
	CSRFToken(r *http.Request) string
	// PutFlash leaves a message for the page after a redirect.
	PutFlash(r *http.Request, text string)
	// Render wraps the page into the site layout.
	Render(w http.ResponseWriter, r *http.Request, status int, page Page)
	ServerError(w http.ResponseWriter, r *http.Request, err error)
	// LogError writes down an error the page is still served after, as the site's error log.
	LogError(r *http.Request, err error)
	// NotFound answers as the site answers an unknown address.
	NotFound(w http.ResponseWriter, r *http.Request)
	// RedirectToLogin sends a guest to the login page, which brings them back to r.URL.Path once
	// signed in.
	RedirectToLogin(w http.ResponseWriter, r *http.Request)
}

type Page struct {
	Title, Description, Canonical string
	NoIndex                       bool
	// Body is the forum page, already rendered by the forum templates.
	Body template.HTML
}

type Forum struct {
	db        *pgxpool.Pool
	baseURL   string
	host      Host
	templates *template.Template
	mux       *http.ServeMux
	// now is the time the pages count "5 minutes ago" from; tests set it.
	now func() time.Time
}

//go:embed templates/*.html
var templateFiles embed.FS

// New takes the site address without a trailing slash, as BASE_URL.
func New(db *pgxpool.Pool, baseURL string, host Host) (*Forum, error) {
	ts, err := template.New("forum").
		Funcs(template.FuncMap{
			"t":        i18n.TemplateT,
			"humanDay": i18n.FormatDay,
			"count":    i18n.FormatCount, // a number without t: {{count .AuthorPosts}}
			"markdown": renderMarkdown,
		}).
		ParseFS(templateFiles, "templates/*.html")
	if err != nil {
		return nil, err
	}
	f := &Forum{db: db, baseURL: strings.TrimRight(baseURL, "/"), host: host, templates: ts, now: time.Now}
	f.mux = f.routes()
	return f, nil
}

// Handler serves every address under /forum/; the app mounts it behind its session, CSRF,
// authentication and language middleware.
func (f *Forum) Handler() http.Handler {
	return f.mux
}

// UnreadNotifications is the counter next to the forum link of the site nav.
func (f *Forum) UnreadNotifications(ctx context.Context, userID int) (int, error) {
	return 0, nil
}

func (f *Forum) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /forum/{$}", f.withView(f.home))
	mux.HandleFunc("GET /forum/section/{id}", f.withView(f.section))
	mux.HandleFunc("GET /forum/topic/{id}", f.withView(f.topic))
	mux.HandleFunc("GET /forum/post/{id}", f.withView(f.post))
	mux.HandleFunc("GET /forum/section/{id}/new", f.withView(f.newTopic))
	mux.HandleFunc("POST /forum/section/{id}/new", f.withView(f.newTopic))
	mux.HandleFunc("GET /forum/topic/{id}/reply", f.withView(f.replyLink))
	mux.HandleFunc("POST /forum/topic/{id}/reply", f.withView(f.replyPost))
	mux.HandleFunc("GET /forum/post/{id}/edit", f.withView(f.editPost))
	mux.HandleFunc("POST /forum/post/{id}/edit", f.withView(f.editPost))
	mux.HandleFunc("GET /forum/post/{id}/delete", f.withView(f.deletePost))
	mux.HandleFunc("POST /forum/post/{id}/delete", f.withView(f.deletePost))
	mux.HandleFunc("GET /forum/post/{id}/restore", f.withView(f.restorePost))
	mux.HandleFunc("POST /forum/post/{id}/restore", f.withView(f.restorePost))
	mux.HandleFunc("GET /forum/post/{id}/quote", f.withView(f.quotePost))
	mux.HandleFunc("POST /forum/preview", f.withView(f.preview))
	mux.HandleFunc("GET /forum/topic/{id}/unread", f.withView(f.firstUnread))
	mux.HandleFunc("POST /forum/read", f.withView(f.markAllRead))
	mux.HandleFunc("POST /forum/section/{id}/read", f.withView(f.markSectionRead))
	mux.HandleFunc("GET /forum/topic/{id}/mod/{action}", f.withView(f.moderateTopic))
	mux.HandleFunc("POST /forum/topic/{id}/mod/{action}", f.withView(f.moderateTopic))
	mux.HandleFunc("GET /forum/mod/sections", f.withView(f.sectionsPage))
	mux.HandleFunc("GET /forum/mod/sections/new", f.withView(f.editSection))
	mux.HandleFunc("POST /forum/mod/sections/new", f.withView(f.editSection))
	mux.HandleFunc("GET /forum/mod/sections/{id}/edit", f.withView(f.editSection))
	mux.HandleFunc("POST /forum/mod/sections/{id}/edit", f.withView(f.editSection))
	mux.HandleFunc("POST /forum/mod/sections/{id}/move", f.withView(f.moveSection))
	// Without it ServeMux answers an unknown address with its own text instead of the site's 404.
	mux.HandleFunc("/forum/", f.host.NotFound)
	return mux
}

// view is what every handler gets from withView and every page template sees; a page embeds it
// in its own data.
type view struct {
	Lang      string
	TimeZone  *time.Location
	CSRFToken string
	Viewer    Viewer
	Now       time.Time
}

func (f *Forum) view(r *http.Request) view {
	return view{
		Lang:      i18n.FromContext(r.Context()),
		TimeZone:  util.GetTimeLocation(r),
		CSRFToken: f.host.CSRFToken(r),
		Now:       f.now(),
	}
}

// Time is a time of the forum as its pages show it: how long ago, the full date on hover
// (_prd/forum/design/decisions.md, 4). In a template: {{$.Time .CreatedAt}}.
func (v view) Time(t time.Time) template.HTML {
	if t.IsZero() {
		return ""
	}
	return template.HTML(fmt.Sprintf(`<time datetime="%s" title="%s">%s</time>`,
		t.UTC().Format(time.RFC3339),
		template.HTMLEscapeString(i18n.FormatDate(v.Lang, t, v.TimeZone)),
		template.HTMLEscapeString(i18n.FormatAgo(v.Lang, t, v.Now, v.TimeZone))))
}

// render executes the template of the page file name (templates/<name>) into page.Body and
// hands the page to the host.
func (f *Forum) render(w http.ResponseWriter, r *http.Request, status int, name string, data any, page Page) {
	buf := new(bytes.Buffer)
	if err := f.templates.ExecuteTemplate(buf, name, data); err != nil {
		f.host.ServerError(w, r, err)
		return
	}
	page.Body = template.HTML(buf.String())
	f.host.Render(w, r, status, page)
}
