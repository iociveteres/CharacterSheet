package models

import (
	"strings"
	"testing"
)

// Testing character sheet contents has little reason.
// JSON schema is a subject to change and maintaining tests is a chore.
// Should think about it, is there anything worth testing?

// The quota error names the MB used, the limit and what is added in the
// language of the one who asked, Russian with a decimal comma.
func TestQuotaErrorMessage(t *testing.T) {
	e := &QuotaError{Used: 19 << 19, Adding: 1258291, Limit: QuotaBytes}
	tests := map[string][]string{
		"en": {"9.5", "10", "1.2"},
		"ru": {"9,5", "10", "1,2"},
	}
	for lang, numbers := range tests {
		got := e.Message(lang)
		for _, n := range numbers {
			if !strings.Contains(got, n) {
				t.Errorf("Message(%q) = %q, want %s in it", lang, got, n)
			}
		}
	}
	if e.Message("en") == e.Message("ru") {
		t.Error("the message is the same in both languages")
	}
}
