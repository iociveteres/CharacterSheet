// Package forum is the site's forum. It imports no other feature of the app and neither webapp
// nor templates: the app hands it a pool, the site address and a Host (_prd/forum/plan.md).
package forum

import (
	"bytes"
	"context"
	"embed"
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
	// NotFound answers as the site answers an unknown address.
	NotFound(w http.ResponseWriter, r *http.Request)
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
}

//go:embed templates/*.html
var templateFiles embed.FS

// New takes the site address without a trailing slash, as BASE_URL.
func New(db *pgxpool.Pool, baseURL string, host Host) (*Forum, error) {
	ts, err := template.New("forum").
		Funcs(template.FuncMap{
			"t":         i18n.TemplateT,
			"humanDate": i18n.FormatDate, // the site's name: {{humanDate .Lang .CreatedAt .TimeZone}}
			"humanDay":  i18n.FormatDay,
			"markdown":  renderMarkdown,
		}).
		ParseFS(templateFiles, "templates/*.html")
	if err != nil {
		return nil, err
	}
	f := &Forum{db: db, baseURL: strings.TrimRight(baseURL, "/"), host: host, templates: ts}
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
}

func (f *Forum) view(r *http.Request) view {
	return view{
		Lang:      i18n.FromContext(r.Context()),
		TimeZone:  util.GetTimeLocation(r),
		CSRFToken: f.host.CSRFToken(r),
	}
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
