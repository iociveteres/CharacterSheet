package webapp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
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

func (app *Application) logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.Header.Get("X-Real-IP")
		if ip == "" {
			ipList := r.Header.Get("X-Forwarded-For")
			if ipList != "" {
				ip = strings.Split(ipList, ",")[0]
			} else {
				ip = r.RemoteAddr
			}
		}
		app.InfoLog.Printf("%s - %s %s %s", ip, r.Proto, r.Method, r.URL.RequestURI())
		next.ServeHTTP(w, r)
	})
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
		// The query that checks the user also brings the language, so the language
		// middleware needs none of its own.
		locale, err := app.Models.Users.GetLocale(r.Context(), id)
		if err != nil && !errors.Is(err, models.ErrNoRecord) {
			app.serverError(w, err)
			return
		}
		if err == nil {
			ctx := context.WithValue(r.Context(), isAuthenticatedContextKey, true)
			ctx = context.WithValue(ctx, userLocaleContextKey, locale)
			r = r.WithContext(ctx)
		}

		next.ServeHTTP(w, r)
	})
}

// langCookie keeps the language of a guest, and of a user on a device until sign-in.
const langCookie = "lang"

// language puts the language of the request into its context: the signed-in user's choice,
// then the cookie, then Accept-Language. It goes after authenticate.
func (app *Application) language(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lang, _ := r.Context().Value(userLocaleContextKey).(string)
		if !i18n.Supported(lang) {
			lang = ""
			if c, err := r.Cookie(langCookie); err == nil && i18n.Supported(c.Value) {
				lang = c.Value
			}
		}
		if lang == "" {
			lang = i18n.FromAcceptLanguage(r.Header.Get("Accept-Language"))
		}
		next.ServeHTTP(w, r.WithContext(i18n.WithLang(r.Context(), lang)))
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
