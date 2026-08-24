package templates

import (
	"fmt"
	"time"

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

func isElevated(role models.RoomRole) bool {
	return role == models.RoleGamemaster || role == models.RoleModerator
}

func isGamemaster(role models.RoomRole) bool {
	return role == models.RoleGamemaster
}

func rfc3399(t time.Time) string {
	return t.Format(time.RFC3339)
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
