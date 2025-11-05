package main

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

		w.Header().Set("Content-Security-Policy",
			"default-src 'self';"+
				"style-src 'self' fonts.googleapis.com;"+
				"font-src fonts.gstatic.com;"+
				"script-src 'self' https://cdn.jsdelivr.net 'sha256-rAgrpzTv+hCaJexh6t73yGbSgpAtDlQoV9C3F6shS0Q=';"+
				"connect-src 'self' ws://localhost:4000")
		w.Header().Set("Referrer-Policy", "origin-when-cross-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "deny")
		w.Header().Set("X-XSS-Protection", "0")
		next.ServeHTTP(w, r)
	})
}

func (app *application) logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.Header.Get("X-Real-IP")
		if ip == "" {
			// fallback to X-Forwarded-For (first IP in the list)
			ipList := r.Header.Get("X-Forwarded-For")
			if ipList != "" {
				// X-Forwarded-For may contain multiple IPs: client,proxy1,proxy2
				ip = strings.Split(ipList, ",")[0]
			} else {
				// fallback to RemoteAddr
				ip = r.RemoteAddr
			}
		}
		app.infoLog.Printf("%s - %s %s %s", ip, r.Proto, r.Method, r.URL.RequestURI())
		next.ServeHTTP(w, r)
	})
}

func (app *application) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Create a deferred function (which will always be run in the event
		// of a panic as Go unwinds the stack).
		defer func() {
			// Use the builtin recover function to check if there has been a
			// panic or not. If there has...
			if err := recover(); err != nil {
				// Set a "Connection: close" header on the response.
				w.Header().Set("Connection", "close")
				// Call the app.serverError helper method to return a 500
				// Internal Server response.
				app.serverError(w, fmt.Errorf("%s", err))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (app *application) requireAuthentication(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// If the user is not authenticated, redirect them to the login page and
		// return from the middleware chain so that no subsequent handlers in
		// the chain are executed.
		if !app.isAuthenticated(r) {
			app.sessionManager.Put(r.Context(), "redirectPathAfterLogin", r.URL.Path)
			http.Redirect(w, r, "/user/login", http.StatusSeeOther)
			return
		}
		// Otherwise set the "Cache-Control: no-store" header so that pages
		// require authentication are not stored in the users browser cache (or
		// other intermediary cache).
		w.Header().Add("Cache-Control", "no-store")
		// And call the next handler in the chain.
		next.ServeHTTP(w, r)
	})
}

// Use a customized CSRF cookie with the Secure, Path and HttpOnly attributes set.
func noSurf(next http.Handler) http.Handler {
	csrfHandler := nosurf.New(next)
	csrfHandler.SetBaseCookie(http.Cookie{
		HttpOnly: true,
		Path:     "/",
		Secure:   true,
	})
	return csrfHandler
}

func (app *application) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Retrieve the authenticatedUserID value from the session.
		// This will return the zero value for an int (0) if no
		// "authenticatedUserID" value is in the session -- in which case we
		// call the next handler in the chain as normal and return.
		id := app.sessionManager.GetInt(r.Context(), "authenticatedUserID")
		if id == 0 {
			next.ServeHTTP(w, r)
			return
		}
		// Otherwise, we check to see if a user with that ID exists in our
		// database.
		exists, err := app.models.Users.Exists(r.Context(), id)
		if err != nil {
			app.serverError(w, err)
			return
		}
		// If a matching user is found, the request is coming from
		// an authenticated user who exists in our database.
		if exists {
			ctx := context.WithValue(r.Context(), isAuthenticatedContextKey, true)
			r = r.WithContext(ctx)
		}

		next.ServeHTTP(w, r)
	})
}

func (app *application) cacheStaticAssets(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/static/") {
			ext := filepath.Ext(r.URL.Path)
			var maxAge string

			switch ext {
			case ".css", ".js":
				maxAge = "max-age=2592000" // 30 days
			case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico":
				maxAge = "max-age=2592000" // 30 days
			default:
				maxAge = "max-age=86400" // 1 day
			}

			w.Header().Set("Cache-Control", "public, "+maxAge+", immutable")
		}

		next.ServeHTTP(w, r)
	})
}
