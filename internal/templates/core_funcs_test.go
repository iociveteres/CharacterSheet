package templates

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
	"time"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestHumanDate(t *testing.T) {
	cet := time.FixedZone("CET", 1*60*60)
	tests := []struct {
		name string
		lang string
		tm   time.Time
		loc  *time.Location
		want string
	}{
		{name: "UTC", lang: "en", tm: time.Date(2022, 3, 17, 10, 15, 0, 0, time.UTC), want: "17 Mar 2022 at 10:15"},
		{name: "Empty", lang: "en", tm: time.Time{}, want: ""},
		{name: "CET", lang: "en", tm: time.Date(2022, 3, 17, 10, 15, 0, 0, cet), want: "17 Mar 2022 at 09:15"},
		{name: "ru", lang: "ru", tm: time.Date(2022, 3, 17, 10, 15, 0, 0, time.UTC), want: "17 марта 2022 в 10:15"},
		{name: "ru day without a leading zero", lang: "ru", tm: time.Date(2026, 1, 2, 9, 5, 0, 0, time.UTC), want: "2 января 2026 в 09:05"},
		{name: "ru in the viewer's zone", lang: "ru", tm: time.Date(2025, 12, 31, 23, 30, 0, 0, time.UTC), loc: cet, want: "1 января 2026 в 00:30"},
		{name: "ru empty", lang: "ru", tm: time.Time{}, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, humanDate(tt.lang, tt.tm, tt.loc), tt.want)
		})
	}
}

// No one online has a text of its own; a count names the number.
func TestFormatOnlineCount(t *testing.T) {
	for _, lang := range []string{"en", "ru"} {
		none := formatOnlineCount(lang, 0)
		if none == "" || strings.Contains(none, "0") {
			t.Errorf("%s: no one online reads %q", lang, none)
		}
		for _, n := range []int{1, 3, 11, 21} {
			if got := formatOnlineCount(lang, n); got == none || !strings.Contains(got, strconv.Itoa(n)) {
				t.Errorf("%s: %d online reads %q", lang, n, got)
			}
		}
	}
}

func TestOnlineCountForms(t *testing.T) {
	s, err := onlineCountForms("ru")
	assert.NilError(t, err)
	var forms map[string]string
	assert.NilError(t, json.Unmarshal([]byte(s), &forms))
	assert.Equal(t, forms["zero"], formatOnlineCount("ru", 0))
	// main.js picks the Russian form itself: all three, with the count left to fill in.
	for _, form := range []string{"one", "few", "many"} {
		if !strings.Contains(forms[form], "{count}") {
			t.Errorf("form %s = %q, want {count} in it", form, forms[form])
		}
	}
}
