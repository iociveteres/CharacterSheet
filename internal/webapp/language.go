package webapp

import (
	"net/http"
	"net/url"
	"strings"

	"charactersheet.iociveteres.net/internal/i18n"
)

// languagePost is the language switcher in the nav: it saves the language to the account of
// a signed-in user and to the cookie in any case, then goes back to the page.
func (app *Application) languagePost(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		app.clientError(w, http.StatusBadRequest)
		return
	}
	lang := r.PostForm.Get("lang")
	if !i18n.Supported(lang) {
		app.clientError(w, http.StatusBadRequest)
		return
	}

	if app.isAuthenticated(r) {
		if err := app.Models.Users.SetLocale(r.Context(), app.userID(r), lang); err != nil {
			app.serverError(w, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name:     langCookie,
		Value:    lang,
		Path:     "/",
		MaxAge:   365 * 24 * 60 * 60,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})

	// Only a path of this site. Browsers read a backslash as a slash, so "/\host" would be
	// "//host"; url.Parse refuses the control characters they drop, as in "/\t/host".
	redirect := r.PostForm.Get("redirect")
	u, err := url.Parse(redirect)
	if err != nil || u.Scheme != "" || u.Host != "" || !strings.HasPrefix(redirect, "/") ||
		strings.HasPrefix(redirect, "//") || strings.Contains(redirect, "\\") {
		redirect = "/"
	}
	http.Redirect(w, r, redirect, http.StatusSeeOther)
}
