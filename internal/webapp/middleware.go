package webapp

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/justinas/nosurf"
)

func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nonce := generateNonce()
		ctx := context.WithValue(r.Context(), "csp-nonce", nonce)

		w.Header().Set("Content-Security-Policy",
			"default-src 'self';"+
				"style-src 'self' fonts.googleapis.com;"+
				"font-src fonts.gstatic.com;"+
				"script-src 'self' https://cdn.jsdelivr.net cloud.umami.is 'sha256-rAgrpzTv+hCaJexh6t73yGbSgpAtDlQoV9C3F6shS0Q=' 'nonce-"+nonce+"';"+
				"connect-src 'self' https://api-gateway.umami.dev/api/send")
		w.Header().Set("Referrer-Policy", "origin-when-cross-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "deny")
		w.Header().Set("X-XSS-Protection", "0")
		next.ServeHTTP(w, r.WithContext(ctx))
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
