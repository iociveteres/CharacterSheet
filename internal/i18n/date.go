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
