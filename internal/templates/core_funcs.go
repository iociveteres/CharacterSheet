package templates

import (
	"encoding/json"
	"fmt"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/ui"
)

// humanDate is i18n.FormatDate: the forum formats dates too and may not import this package.
func humanDate(lang string, t time.Time, loc *time.Location) string {
	return i18n.FormatDate(lang, t, loc)
}

func dict(values ...interface{}) map[string]interface{} {
	m := make(map[string]interface{}, len(values)/2)
	for i := 0; i < len(values); i += 2 {
		k, ok := values[i].(string)
		if !ok || i+1 >= len(values) {
			continue
		}
		m[k] = values[i+1]
	}
	return m
}

// slideURL is "slide" in templates: the landing slide recorded in the page language
// (scripts/slides), the English one where that language has none.
func slideURL(lang, name, theme, ext string) string {
	path := ""
	for _, l := range []string{lang, i18n.Default} {
		path = fmt.Sprintf("img/slides/%s-%s-%s.%s", name, l, theme, ext)
		if hash, ok := ui.StaticHash(path); ok {
			return "/static/" + path + "?v=" + hash
		}
	}
	return "/static/" + path
}

func isElevated(role models.RoomRole) bool {
	return role == models.RoleGamemaster || role == models.RoleModerator
}

func isGamemaster(role models.RoomRole) bool {
	return role == models.RoleGamemaster
}

func str(v interface{}) string {
	return fmt.Sprint(v)
}

func formatOnlineCount(lang string, n int) string {
	if n <= 0 {
		return i18n.T(lang, "site.home.online.none")
	}
	return i18n.T(lang, "site.home.online.count", i18n.Params{"count": n})
}

// onlineCountForms gives main.js the texts of formatOnlineCount for the count it polls:
// "zero" and the plural forms with {count} left in.
func onlineCountForms(lang string) (string, error) {
	forms := i18n.PluralForms(lang, "site.home.online.count")
	if forms == nil {
		forms = map[string]string{}
	}
	forms["zero"] = i18n.T(lang, "site.home.online.none")
	b, err := json.Marshal(forms)
	return string(b), err
}
