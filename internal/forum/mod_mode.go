package forum

import "net/http"

// The moderator mode is kept in a cookie as the density is, each device its own
// (_prd/forum/moderator-mode/plan.md). Off by default: a moderator reads the forum as a member does
// until they turn it on. It changes only what pages show; what the moderator may do stays their
// role's (Viewer.Shown).
const modModeCookie = "forum_mod_mode"

func modModeFromRequest(r *http.Request) bool {
	c, err := r.Cookie(modModeCookie)
	return err == nil && c.Value == "on"
}

// setModMode is the mode's item of the home's menu «Moderation ▾» and «Turn off» on the strip of
// every page; back to the page it came from. Only a moderator has the mode, so nobody else gets the
// cookie.
func (f *Forum) setModMode(w http.ResponseWriter, r *http.Request, v view) {
	if !v.Viewer.CanModerate() {
		forbidden(w)
		return
	}
	switch r.PostFormValue("mode") {
	case "on":
		http.SetCookie(w, modModeCookieOf("on", 365*24*60*60))
	case "off":
		// Off is no cookie, as the default of the density is.
		http.SetCookie(w, modModeCookieOf("", -1))
	default:
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	http.Redirect(w, r, forumRedirect(r.PostFormValue("redirect")), http.StatusSeeOther)
}

func modModeCookieOf(value string, maxAge int) *http.Cookie {
	c := densityCookieOf(value, maxAge)
	c.Name = modModeCookie
	return c
}
