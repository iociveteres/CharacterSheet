package i18n

import (
	"fmt"
	"time"
)

// Genitive, as in "2 января": Go formats month names in English only.
var ruMonths = [...]string{"января", "февраля", "марта", "апреля", "мая", "июня",
	"июля", "августа", "сентября", "октября", "ноября", "декабря"}

// FormatDate is the date and time of the site's pages, "17 Mar 2022 at 10:15" or
// "17 марта 2022 в 10:15", in loc (UTC when nil, as for a visitor without the tz cookie). A zero
// time is an empty string.
func FormatDate(lang string, t time.Time, loc *time.Location) string {
	if t.IsZero() {
		return ""
	}
	if loc == nil {
		loc = time.UTC
	}
	t = t.In(loc)
	if lang == "ru" {
		return fmt.Sprintf("%d %s %d в %s", t.Day(), ruMonths[t.Month()-1], t.Year(), t.Format("15:04"))
	}
	return t.Format("02 Jan 2006 at 15:04")
}

// FormatDay is the day of t in digits, as a locale writes it: "10/2/2026" or "02.10.2026".
func FormatDay(lang string, t time.Time, loc *time.Location) string {
	if t.IsZero() {
		return ""
	}
	if loc == nil {
		loc = time.UTC
	}
	t = t.In(loc)
	if lang == "ru" {
		return t.Format("02.01.2006")
	}
	return t.Format("1/2/2006")
}

// FormatAgo is how long before now t was, "5 minutes ago" or "2 месяца назад"; from a year back
// it is the full date of FormatDate. now is a parameter for the tests.
func FormatAgo(lang string, t, now time.Time, loc *time.Location) string {
	if t.IsZero() {
		return ""
	}
	key, n := ago(t, now)
	if key == "" {
		return FormatDate(lang, t, loc)
	}
	return T(lang, key, Params{"count": n})
}

// ago is the catalog key and the count of FormatAgo; an empty key from a year back. A month is
// 30 days.
// i18n-keys: server.time.*
func ago(t, now time.Time) (string, int) {
	if t.Before(now.AddDate(-1, 0, 0)) {
		return "", 0
	}
	const day = 24 * time.Hour
	switch d := now.Sub(t); {
	case d < time.Minute:
		// A clock a little ahead of the server's lands here too.
		return "server.time.justNow", 0
	case d < time.Hour:
		return "server.time.minutesAgo", int(d / time.Minute)
	case d < day:
		return "server.time.hoursAgo", int(d / time.Hour)
	case d < 30*day:
		return "server.time.daysAgo", int(d / day)
	default:
		return "server.time.monthsAgo", int(d / (30 * day))
	}
}
