package i18n

import (
	"testing"
	"time"
)

func TestFormatDay(t *testing.T) {
	cet := time.FixedZone("CET", 1*60*60)
	tests := []struct {
		name string
		lang string
		tm   time.Time
		loc  *time.Location
		want string
	}{
		{name: "en", lang: "en", tm: time.Date(2022, 3, 17, 10, 15, 0, 0, time.UTC), want: "17 Mar 2022"},
		{name: "ru", lang: "ru", tm: time.Date(2026, 1, 2, 9, 5, 0, 0, time.UTC), want: "2 января 2026"},
		{name: "in the viewer's zone", lang: "ru", tm: time.Date(2025, 12, 31, 23, 30, 0, 0, time.UTC), loc: cet, want: "1 января 2026"},
		{name: "empty", lang: "en", tm: time.Time{}, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatDay(tt.lang, tt.tm, tt.loc); got != tt.want {
				t.Errorf("FormatDay = %q, want %q", got, tt.want)
			}
		})
	}
}
