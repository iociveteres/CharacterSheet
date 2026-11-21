package webapp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/templates"
	"charactersheet.iociveteres.net/internal/util"
	"github.com/go-playground/form/v4"
	"github.com/justinas/nosurf"
)

// setDownload makes the response a file the browser saves as name. A plain
// filename may hold only ASCII, a raw UTF-8 one is guessed at: the name goes
// as filename* (RFC 6266), which browsers prefer, after an ASCII fallback.
func setDownload(w http.ResponseWriter, name string) {
	var fallback, encoded strings.Builder
	for _, r := range name {
		if r >= 0x20 && r < 0x7f && r != '"' && r != '\\' {
			fallback.WriteRune(r)
		} else {
			fallback.WriteByte('_')
		}
	}
	for _, b := range []byte(name) {
		// The attr-char of RFC 5987 go as they are, the other bytes encoded.
		if 'a' <= b && b <= 'z' || 'A' <= b && b <= 'Z' || '0' <= b && b <= '9' || strings.IndexByte("!#$&+-.^_`|~", b) >= 0 {
			encoded.WriteByte(b)
		} else {
			fmt.Fprintf(&encoded, "%%%02X", b)
		}
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, fallback.String(), encoded.String()))
}

func (app *Application) serverError(w http.ResponseWriter, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}

	trace := fmt.Sprintf("%s\n%s", err.Error(), debug.Stack())
	app.ErrorLog.Output(2, trace)

	if app.Debug {
		http.Error(w, trace, http.StatusInternalServerError)
		return
	}

	http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
}

func (app *Application) clientError(w http.ResponseWriter, status int) {
	http.Error(w, http.StatusText(status), status)
}

func (app *Application) notFound(w http.ResponseWriter) {
	app.clientError(w, http.StatusNotFound)
}

func (app *Application) isAuthenticated(r *http.Request) bool {
	isAuthenticated, ok := r.Context().Value(isAuthenticatedContextKey).(bool)
	if !ok {
		return false
	}
	return isAuthenticated
}

func (app *Application) render(w http.ResponseWriter, status int, page string, tplName string, data *templates.Data) {
	ts, ok := app.TemplateCache[data.Lang][page]
	if !ok {
		err := fmt.Errorf("the template %s does not exist", page)
		app.serverError(w, err)
		return
	}

	buf := new(bytes.Buffer)
	if err := ts.ExecuteTemplate(buf, tplName, data); err != nil {
		app.serverError(w, err)
		return
	}

	w.WriteHeader(status)
	buf.WriteTo(w)
}

func (app *Application) newTemplateData(r *http.Request) *templates.Data {
	// The cookie is set by the notice's close button (main.js); deciding on the server keeps the
	// closed notice from flashing on every page load.
	_, noticeClosed := r.Cookie("incident_notice_closed")
	return &templates.Data{
		Lang:               i18n.FromContext(r.Context()),
		RequestURI:         r.URL.RequestURI(),
		ShowIncidentNotice: noticeClosed != nil,
		CurrentYear:        time.Now().Year(),
		Flash:              app.SessionManager.PopString(r.Context(), "flash"),
		IsAuthenticated:    app.isAuthenticated(r),
		CSRFToken:          nosurf.Token(r),
		TimeZone:           util.GetTimeLocation(r),
		OnlineUsers:        app.onlineUsersCount(),
		ForumBadge:         app.forumBadge(r),
	}
}

func (app *Application) decodePostForm(r *http.Request, dst any) error {
	err := r.ParseForm()
	if err != nil {
		return err
	}

	err = app.FormDecoder.Decode(dst, r.PostForm)
	if err != nil {
		var invalidDecoderError *form.InvalidDecoderError
		if errors.As(err, &invalidDecoderError) {
			panic(err)
		}
		return err
	}
	return nil
}

func getOrigin(r *http.Request) string {
	scheme := "http"
	if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (app *Application) background(fn func()) {
	app.wg.Add(1)

	go func() {
		defer app.wg.Done()
		defer func() {
			if err := recover(); err != nil {
				app.ErrorLog.Output(2, fmt.Sprintf("%s", err))
			}
		}()

		fn()
	}()
}
