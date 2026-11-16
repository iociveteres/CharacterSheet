package templates

import (
	"fmt"
	"time"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/models"
)

const humanDateLayout = "02 Jan 2006 at 15:04"

func humanDate(t time.Time, loc *time.Location) string {
	if t.IsZero() {
		return ""
	}
	if loc == nil {
		loc = time.UTC
	}
	return t.In(loc).Format(humanDateLayout)
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

// translate is "t" in templates: {{t .Lang "site.nav.rooms"}}, params as name/value pairs:
// {{t .Lang "x.y" "count" 3}}.
func translate(lang, key string, pairs ...any) (string, error) {
	if len(pairs)%2 != 0 {
		return "", fmt.Errorf("t %q: params must be name/value pairs", key)
	}
	params := i18n.Params{}
	for i := 0; i < len(pairs); i += 2 {
		name, ok := pairs[i].(string)
		if !ok {
			return "", fmt.Errorf("t %q: param name %v is not a string", key, pairs[i])
		}
		params[name] = pairs[i+1]
	}
	return i18n.T(lang, key, params), nil
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

func formatOnlineCount(n int) string {
	switch {
	case n <= 0:
		return "Be the first online!"
	case n == 1:
		return "1 player online now."
	default:
		return fmt.Sprintf("%d players online now.", n)
	}
}
