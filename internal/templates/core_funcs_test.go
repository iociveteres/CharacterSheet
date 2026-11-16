package templates

import (
	"encoding/json"
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

func TestFormatOnlineCount(t *testing.T) {
	tests := []struct {
		lang string
		n    int
		want string
	}{
		{"en", 0, "Be the first online!"},
		{"en", 1, "1 player online now."},
		{"en", 21, "21 players online now."},
		{"ru", 0, "Пока никого — будьте первым!"},
		{"ru", 1, "Сейчас онлайн 1 игрок."},
		{"ru", 3, "Сейчас онлайн 3 игрока."},
		{"ru", 11, "Сейчас онлайн 11 игроков."},
		{"ru", 21, "Сейчас онлайн 21 игрок."},
	}
	for _, tt := range tests {
		assert.Equal(t, formatOnlineCount(tt.lang, tt.n), tt.want)
	}
}

func TestOnlineCountForms(t *testing.T) {
	s, err := onlineCountForms("ru")
	assert.NilError(t, err)
	var forms map[string]string
	assert.NilError(t, json.Unmarshal([]byte(s), &forms))
	assert.Equal(t, forms["zero"], formatOnlineCount("ru", 0))
	assert.Equal(t, forms["few"], "Сейчас онлайн {count} игрока.")
}
