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
		{name: "ru", lang: "ru", tm: time.Date(2026, 1, 2, 9, 5, 0, 0, time.UTC), want: "02.01.2026"},
		{name: "in the viewer's zone", lang: "ru", tm: time.Date(2025, 12, 31, 23, 30, 0, 0, time.UTC), loc: cet, want: "01.01.2026"},
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

func TestAgo(t *testing.T) {
	now := time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		before time.Duration
		key    string
		n      int
	}{
		{"now", 0, "server.time.justNow", 0},
		{"59 seconds", 59 * time.Second, "server.time.justNow", 0},
		{"a clock ahead", -time.Minute, "server.time.justNow", 0},
		{"a minute", time.Minute, "server.time.minutesAgo", 1},
		{"59 minutes", 59*time.Minute + 59*time.Second, "server.time.minutesAgo", 59},
		{"an hour", time.Hour, "server.time.hoursAgo", 1},
		{"23 hours", 23*time.Hour + 59*time.Minute, "server.time.hoursAgo", 23},
		{"a day", 24 * time.Hour, "server.time.daysAgo", 1},
		{"29 days", 29*24*time.Hour + 23*time.Hour, "server.time.daysAgo", 29},
		{"30 days", 30 * 24 * time.Hour, "server.time.monthsAgo", 1},
		{"364 days", 364 * 24 * time.Hour, "server.time.monthsAgo", 12},
		{"a year and a minute", now.Sub(now.AddDate(-1, 0, 0)) + time.Minute, "", 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key, n := ago(now.Add(-tt.before), now)
			if key != tt.key || n != tt.n {
				t.Errorf("ago = %q %d, want %q %d", key, n, tt.key, tt.n)
			}
		})
	}
}

// From a year back the time is the full date, and in the viewer's zone.
func TestFormatAgoFullDate(t *testing.T) {
	now := time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)
	cet := time.FixedZone("CET", 1*60*60)
	old := time.Date(2025, 11, 9, 21, 2, 0, 0, time.UTC)
	for _, lang := range Languages {
		if got, want := FormatAgo(lang, old, now, cet), FormatDate(lang, old, cet); got != want {
			t.Errorf("%s: FormatAgo = %q, want %q", lang, got, want)
		}
	}
	if got := FormatAgo("en", time.Time{}, now, nil); got != "" {
		t.Errorf("FormatAgo of a zero time = %q", got)
	}
}
