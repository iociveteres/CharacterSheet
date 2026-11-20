package forum

import (
	"net/http"
	"strings"
)

// The density of forum pages is the reader's, kept in a cookie as lang and tz are: a guest has it
// too, and each device its own (_prd/forum/extras/density.md). No cookie is "normal".
const densityCookie = "forum_density"

const (
	densityLarge   = "large"
	densityNormal  = "normal"
	densityCompact = "compact"
)

// densityChoices are the items of the menu "View ▾", in its order.
var densityChoices = []string{densityLarge, densityNormal, densityCompact}

func densityFromRequest(r *http.Request) string {
	c, err := r.Cookie(densityCookie)
	if err != nil {
		return densityNormal
	}
	switch c.Value {
	case densityLarge, densityCompact:
		return c.Value
	}
	return densityNormal
}

// DensityClass is the class of #forum that swaps the variables of forum.css; none for normal,
// whose values are forum.css's own.
func (v view) DensityClass() string {
	if v.Density == densityNormal || v.Density == "" {
		return ""
	}
	return "forum-" + v.Density
}

// DensityChoices is what the menu "View ▾" lists, the reader's current choice marked.
func (v view) DensityChoices() []densityChoice {
	choices := make([]densityChoice, len(densityChoices))
	for i, d := range densityChoices {
		choices[i] = densityChoice{Value: d, Current: d == v.Density}
	}
	return choices
}

type densityChoice struct {
	Value   string
	Current bool
}

// setDensity is a form of the menu "View ▾": it keeps the choice in the cookie, a guest's and a
// banned user's too, and sends the browser back to the forum page it came from.
func (f *Forum) setDensity(w http.ResponseWriter, r *http.Request, v view) {
	d := r.PostFormValue("density")
	switch d {
	case densityLarge, densityCompact:
		http.SetCookie(w, densityCookieOf(d, 365*24*60*60))
	case densityNormal:
		// The default is no cookie, so that a later change of the default reaches this reader.
		http.SetCookie(w, densityCookieOf("", -1))
	default:
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	http.Redirect(w, r, forumRedirect(r.PostFormValue("redirect")), http.StatusSeeOther)
}

func densityCookieOf(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     densityCookie,
		Value:    value,
		Path:     "/forum",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
}

// forumRedirect is target if it is a page of the forum, else the forum home. Browsers read a
// backslash as a slash, so "/forum/\host" could leave the site; "//" too.
func forumRedirect(target string) string {
	if !strings.HasPrefix(target, "/forum/") || strings.Contains(target, "\\") ||
		strings.Contains(target, "//") || strings.ContainsAny(target, "\r\n\t") {
		return "/forum/"
	}
	return target
}
