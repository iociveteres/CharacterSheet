package models

import "testing"

// Testing character sheet contents has little reason.
// JSON schema is a subject to change and maintaining tests is a chore.
// Should think about it, is there anything worth testing?

// The quota error reads in the language of the one who asked, Russian with a
// decimal comma.
func TestQuotaErrorMessage(t *testing.T) {
	e := &QuotaError{Used: 19 << 19, Adding: 1258291, Limit: QuotaBytes}
	tests := map[string]string{
		"en": "NPCs and creatures take 9.5 of 10 MB; this needs 1.2 MB more.",
		"ru": "НПС и существа занимают 9,5 из 10 МБ; нужно ещё 1,2 МБ.",
	}
	for lang, want := range tests {
		if got := e.Message(lang); got != want {
			t.Errorf("Message(%q) = %q, want %q", lang, got, want)
		}
	}
}
