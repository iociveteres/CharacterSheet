package mailer

import (
	"io/fs"
	"strings"
	"testing"
)

func TestRenderByLanguage(t *testing.T) {
	data := map[string]any{"Name": "Alice", "ActivationLink": "https://example.com/verify/x"}
	tests := []struct{ lang, subject string }{
		{"en", "Charactersheet account verification"},
		{"ru", "Подтверждение аккаунта на Character Sheet"},
		// No file in the language: the English one.
		{"de", "Charactersheet account verification"},
	}
	for _, tt := range tests {
		msg, err := Render(tt.lang, "user_verification", data)
		if err != nil {
			t.Fatal(err)
		}
		if msg.Subject != tt.subject {
			t.Errorf("%s: subject %q, want %q", tt.lang, msg.Subject, tt.subject)
		}
		if !strings.Contains(msg.PlainBody, "https://example.com/verify/x") || !strings.Contains(msg.HTMLBody, `href="https://example.com/verify/x"`) {
			t.Errorf("%s: the link is missing from the body", tt.lang)
		}
	}
}

// Every email renders in each language with the data its handler passes.
func TestRenderEveryTemplate(t *testing.T) {
	files, _ := fs.Glob(Templates, "templates/*.html")
	if len(files) == 0 {
		t.Fatal("no templates")
	}
	data := map[string]any{
		"Name":              "Alice",
		"ActivationLink":    "https://example.com/a",
		"ResetPasswordLink": "https://example.com/r",
		"User":              map[string]any{"Name": "Alice"},
	}
	for _, file := range files {
		base := strings.TrimSuffix(strings.TrimPrefix(file, "templates/"), ".html")
		name, lang, _ := strings.Cut(base, ".")
		msg, err := Render(lang, name, data)
		if err != nil {
			t.Errorf("%s: %v", file, err)
			continue
		}
		if msg.Subject == "" || !strings.Contains(msg.HTMLBody, "Alice") {
			t.Errorf("%s: empty subject or body without the name", file)
		}
	}
}
