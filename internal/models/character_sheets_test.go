package models

import (
	"testing"

	"charactersheet.iociveteres.net/internal/i18n"
)

// Testing character sheet contents has little reason.
// JSON schema is a subject to change and maintaining tests is a chore.
// Should think about it, is there anything worth testing?

// The quota error reads in the language of the one who asked, Russian with a
// decimal comma.
func TestQuotaErrorMessage(t *testing.T) {
	e := &QuotaError{Used: 19 << 19, Adding: 1258291, Limit: QuotaBytes}
	tests := map[string]string{
		"en": i18n.T("en", "server.errors.quota", i18n.Params{"used": "9.5", "limit": "10", "adding": "1.2"}),
		"ru": i18n.T("ru", "server.errors.quota", i18n.Params{"used": "9,5", "limit": "10", "adding": "1,2"}),
	}
	for lang, want := range tests {
		if got := e.Message(lang); got != want {
			t.Errorf("Message(%q) = %q, want %q", lang, got, want)
		}
	}
}
