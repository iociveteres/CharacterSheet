package webapp

import (
	"context"
	"fmt"
	"math"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"charactersheet.iociveteres.net/internal/ratelimit"
	"charactersheet.iociveteres.net/ui"
	"github.com/justinas/nosurf"
)

func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy",
			"default-src 'self';"+
				// blob: shows a portrait on its way to the server (sheet/profile/Portrait.tsx).
				"img-src 'self' blob:;"+
				"style-src 'self' fonts.googleapis.com;"+
				"font-src fonts.gstatic.com;"+
				"script-src 'self' cloud.umami.is 'sha256-rAgrpzTv+hCaJexh6t73yGbSgpAtDlQoV9C3F6shS0Q=';"+
				// The collect host is baked into cloud.umami.is/script.js at umami's build and has
				// moved before (from api-gateway.umami.dev): check the script if beacons get blocked.
				"connect-src 'self' https://gateway.umami.is/api/send")
		w.Header().Set("Referrer-Policy", "origin-when-cross-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "deny")
		w.Header().Set("X-XSS-Protection", "0")
		next.ServeHTTP(w, r)
	})
}

// clientAddress is the client's IP. The server listens on 127.0.0.1 behind
// nginx, which sets X-Real-IP; X-Forwarded-For is whatever the client wrote.
func clientAddress(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	// Without the port: each connection has its own.
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func (app *Application) logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		app.InfoLog.Printf("%s - %s %s %s", clientAddress(r), r.Proto, r.Method, r.URL.RequestURI())
		next.ServeHTTP(w, r)
	})
}

// refusal answers a request over its rate limit; the next may come after wait.
type refusal func(w http.ResponseWriter, r *http.Request, wait time.Duration)

// rateLimit lets a request through while its key has tokens in l; an empty
// key is not counted. The rest get 429 with Retry-After, answered by refuse
// or, if it is nil, with the status text.
func (app *Application) rateLimit(l *ratelimit.Limiter, key func(*http.Request) string, refuse refusal) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			k := key(r)
			if k == "" {
				next.ServeHTTP(w, r)
				return
			}
			ok, wait := l.Allow(k)
			if ok {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
			if refuse == nil {
				app.clientError(w, http.StatusTooManyRequests)
				return
			}
			refuse(w, r, wait)
		})
	}
}

// refuseForm shows the page of a form again, with what was sent and an error
// over the form. P is the pointer to the form, which embeds a Validator.
func refuseForm[F any, P interface {
	*F
	AddNonFieldError(string)
}](app *Application, page string) refusal {
	return func(w http.ResponseWriter, r *http.Request, wait time.Duration) {
		var form F
		// A form that does not decode is shown empty: only the error matters.
		_ = app.decodePostForm(r, &form)
		P(&form).AddNonFieldError(tooManyAttempts(wait))
		data := app.newTemplateData(r)
		data.Form = form
		app.render(w, http.StatusTooManyRequests, page, "base", data)
	}
}

func tooManyAttempts(wait time.Duration) string {
	minutes := int(math.Ceil(wait.Minutes()))
	if minutes <= 1 {
		return "Too many attempts. Try again in a minute."
	}
	return fmt.Sprintf("Too many attempts. Try again in %d minutes.", minutes)
}

func (app *Application) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				w.Header().Set("Connection", "close")
				app.serverError(w, fmt.Errorf("%s", err))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (app *Application) requireAuthentication(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !app.isAuthenticated(r) {
			app.SessionManager.Put(r.Context(), "redirectPathAfterLogin", r.URL.Path)
			http.Redirect(w, r, "/user/login", http.StatusSeeOther)
			return
		}
		w.Header().Add("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// limitBody bounds the request body ahead of noSurf: a CSRF token sent in a
// form makes nosurf parse the whole body before the handler runs. A body
// declared larger is refused without reading it.
func (app *Application) limitBody(n int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.ContentLength > n {
				app.clientError(w, http.StatusRequestEntityTooLarge)
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, n)
			next.ServeHTTP(w, r)
		})
	}
}

func noSurf(next http.Handler) http.Handler {
	csrfHandler := nosurf.New(next)
	csrfHandler.SetBaseCookie(http.Cookie{
		HttpOnly: true,
		Path:     "/",
		Secure:   true,
	})
	return csrfHandler
}

func (app *Application) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := app.SessionManager.GetInt(r.Context(), "authenticatedUserID")
		if id == 0 {
			next.ServeHTTP(w, r)
			return
		}
		exists, err := app.Models.Users.Exists(r.Context(), id)
		if err != nil {
			app.serverError(w, err)
			return
		}
		if exists {
			ctx := context.WithValue(r.Context(), isAuthenticatedContextKey, true)
			r = r.WithContext(ctx)
		}

		next.ServeHTTP(w, r)
	})
}

func (app *Application) cacheStaticAssets(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/static/") {
			if ui.DevMode() {
				w.Header().Set("Cache-Control", "no-store")
				next.ServeHTTP(w, r)
				return
			}

			ext := filepath.Ext(r.URL.Path)
			var maxAge string

			switch ext {
			case ".css", ".js":
				maxAge = "max-age=2592000"
			case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico":
				maxAge = "max-age=2592000"
			default:
				maxAge = "max-age=86400"
			}

			w.Header().Set("Cache-Control", "public, "+maxAge+", immutable")
		}

		next.ServeHTTP(w, r)
	})
}
