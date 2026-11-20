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
	// Avatars are the image URLs of these users' avatars in one query; a user without one is not
	// in the map.
	Avatars(ctx context.Context, userIDs []int) (map[int]string, error)
	// AvatarState is whether the user has an avatar and a lock on uploading one.
	AvatarState(ctx context.Context, userID int) (AvatarState, error)
	// RemoveAvatar deletes the user's avatar and, with a lock, forbids a new one until lock.Until
	// (for good when nil); repeating it is safe. The forum writes its log and notification after it,
	// in a transaction of its own (extras/avatars.md, «Граница с форумом»).
	RemoveAvatar(ctx context.Context, userID int, lock *AvatarLock) error
	// LiftAvatarLock lets the user upload an avatar again; without a lock it does nothing.
	LiftAvatarLock(ctx context.Context, userID int) error
	// AvatarLocks are the locks that hold now, the latest first.
	AvatarLocks(ctx context.Context) ([]AvatarLock, error)
	// AccountURL is the page where a user changes their avatar: where a notification about it leads.
	AccountURL() string
}

type Page struct {
	Title, Description, Canonical string
	NoIndex                       bool
	// Body is the forum page, already rendered by the forum templates.
	Body template.HTML
	// ImagesFromAnyHost lets the page show pictures from any https host: posts link them
	// (extras/images.md). Every forum page sets it, the site's other pages keep 'self'.
	ImagesFromAnyHost bool
}

type Forum struct {
	db        *pgxpool.Pool
	baseURL   string
	host      Host
	templates *template.Template
	mux       *http.ServeMux
	// patterns are the routes of mux as registered, for the tests that go through every address.
	patterns []string
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
			// The page of a user, which every name the forum writes links to: {{userURL .AuthorID}}.
			"userURL": userURL,
		}).
		ParseFS(templateFiles, "templates/*.html")
	if err != nil {
		return nil, err
	}
	f := &Forum{db: db, baseURL: strings.TrimRight(baseURL, "/"), host: host, templates: ts, now: time.Now}
	f.mux, f.patterns = f.routes()
	return f, nil
}

// Handler serves every address under /forum/; the app mounts it behind its session, CSRF,
// authentication and language middleware.
func (f *Forum) Handler() http.Handler {
	return f.mux
}

// routeMux is a ServeMux that remembers its patterns: ServeMux does not list them, and the test of
// bans goes through every address that writes (bans_test.go).
type routeMux struct {
	*http.ServeMux
	patterns []string
}

func (m *routeMux) HandleFunc(pattern string, h func(http.ResponseWriter, *http.Request)) {
	m.patterns = append(m.patterns, pattern)
	m.ServeMux.HandleFunc(pattern, h)
}

func (f *Forum) routes() (*http.ServeMux, []string) {
	mux := &routeMux{ServeMux: http.NewServeMux()}
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
	mux.HandleFunc("GET /forum/notifications", f.withView(f.notificationsPage))
	mux.HandleFunc("POST /forum/notifications/read", f.withView(f.readAllNotifications))
	mux.HandleFunc("POST /forum/topic/{id}/subscribe", f.withView(f.subscription(true)))
	mux.HandleFunc("POST /forum/topic/{id}/unsubscribe", f.withView(f.subscription(false)))
	mux.HandleFunc("GET /forum/topic/{id}/mod/{action}", f.withView(f.moderateTopic))
	mux.HandleFunc("POST /forum/topic/{id}/mod/{action}", f.withView(f.moderateTopic))
	mux.HandleFunc("GET /forum/mod/sections", f.withView(f.sectionsPage))
	mux.HandleFunc("GET /forum/mod/sections/new", f.withView(f.editSection))
	mux.HandleFunc("POST /forum/mod/sections/new", f.withView(f.editSection))
	mux.HandleFunc("GET /forum/mod/sections/{id}/edit", f.withView(f.editSection))
	mux.HandleFunc("POST /forum/mod/sections/{id}/edit", f.withView(f.editSection))
	mux.HandleFunc("POST /forum/mod/sections/{id}/move", f.withView(f.moveSection))
	// The ban from a post went into its delete window (block 7 of extras/plan.md); old links land there.
	mux.HandleFunc("GET /forum/post/{id}/ban", f.oldBanPage)
	mux.HandleFunc("GET /forum/mod/bans", f.withView(f.bansPage))
	mux.HandleFunc("POST /forum/mod/bans/{id}/lift", f.withView(f.liftBan))
	mux.HandleFunc("GET /forum/mod/log", f.withView(f.modLogPage))
	mux.HandleFunc("POST /forum/mod/log/{id}/restore", f.withView(f.restoreRecent))
	mux.HandleFunc("POST /forum/view/density", f.withView(f.setDensity))
	mux.HandleFunc("POST /forum/view/images", f.withView(f.setImages))
	mux.HandleFunc("GET /forum/user/{id}", f.withView(f.userPage))
	mux.HandleFunc("POST /forum/user/{id}/about", f.withView(f.saveAbout))
	mux.HandleFunc("POST /forum/user/{id}/about/erase", f.withView(f.eraseAbout))
	mux.HandleFunc("POST /forum/user/{id}/ban", f.withView(f.banFromPage))
	mux.HandleFunc("POST /forum/user/{id}/lift-ban", f.withView(f.liftUserBan))
	mux.HandleFunc("POST /forum/user/{id}/avatar", f.withView(f.removeAvatar))
	mux.HandleFunc("POST /forum/user/{id}/lift-avatar-lock", f.withView(f.liftAvatarLock))
	// Without it ServeMux answers an unknown address with its own text instead of the site's 404.
	mux.HandleFunc("/forum/", f.host.NotFound)
	return mux.ServeMux, mux.patterns
}

// view is what every handler gets from withView and every page template sees; a page embeds it
// in its own data.
type view struct {
	Lang      string
	TimeZone  *time.Location
	CSRFToken string
	Viewer    Viewer
	Now       time.Time
	// Density is the reader's step of the menu "View ▾" (density.go).
	Density string
	// ImagesOpen is the menu's "Pictures at once": the pictures of posts are not under a spoiler.
	ImagesOpen bool
}

func (f *Forum) view(r *http.Request) view {
	return view{
		Lang:       i18n.FromContext(r.Context()),
		TimeZone:   util.GetTimeLocation(r),
		CSRFToken:  f.host.CSRFToken(r),
		Now:        f.now(),
		Density:    densityFromRequest(r),
		ImagesOpen: imagesOpenFromRequest(r),
	}
}

// Markdown is a post's Markdown as this reader sees it: {{$.Markdown .Body}}.
func (v view) Markdown(src string) (template.HTML, error) {
	return renderMarkdown(src, renderOptions{Lang: v.Lang, ImagesOpen: v.ImagesOpen})
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

// Date is the full date and time, for what is to come rather than past: the end of a ban
// (design/decisions.md, 4).
func (v view) Date(t time.Time) string {
	return i18n.FormatDate(v.Lang, t, v.TimeZone)
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
	page.ImagesFromAnyHost = true
	if page.Description == "" {
		page.Description = i18n.T(i18n.FromContext(r.Context()), "forum.sections.description")
	}
	f.host.Render(w, r, status, page)
}
