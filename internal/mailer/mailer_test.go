package mailer

import (
	"io/fs"
	"strings"
	"testing"
)

func TestRenderByLanguage(t *testing.T) {
	data := map[string]any{"Name": "Alice", "ActivationLink": "https://example.com/verify/x"}
	subjects := map[string]string{}
	for _, lang := range []string{"en", "ru", "de"} {
		msg, err := Render(lang, "user_verification", data)
		if err != nil {
			t.Fatal(err)
		}
		subjects[lang] = msg.Subject
		if !strings.Contains(msg.PlainBody, "https://example.com/verify/x") || !strings.Contains(msg.HTMLBody, `href="https://example.com/verify/x"`) {
			t.Errorf("%s: the link is missing from the body", lang)
		}
	}
	// No file in the language: the English one.
	if subjects["en"] == "" || subjects["ru"] == subjects["en"] || subjects["de"] != subjects["en"] {
		t.Errorf("subjects %q, want a Russian one and the English one for de", subjects)
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
		"DeleteLink":        "https://example.com/d",
		"CancelLink":        "https://example.com/c",
		"DeleteAt":          "24 Nov 2026 at 21:00 UTC",
		"NewEmail":          "n•••@example.com",
		"ConfirmLink":       "https://example.com/e",
		"RevertLink":        "https://example.com/v",
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

// The emails of the deletion of an account carry their links in both bodies, in each language.
func TestRenderAccountDeletionLinks(t *testing.T) {
	links := map[string]string{
		"account_delete_link":      "DeleteLink",
		"account_delete_scheduled": "CancelLink",
		"account_delete_reminder":  "CancelLink",
	}
	for name, field := range links {
		for _, lang := range []string{"en", "ru"} {
			link := "https://example.com/" + name
			msg, err := Render(lang, name, map[string]any{"Name": "Alice", field: link, "DeleteAt": "x"})
			if err != nil {
				t.Fatalf("%s.%s: %v", name, lang, err)
			}
			if !strings.Contains(msg.PlainBody, link) || !strings.Contains(msg.HTMLBody, `href="`+link+`"`) {
				t.Errorf("%s.%s: the link is missing from a body", name, lang)
			}
		}
	}
}

// The emails of an email change carry their links in both bodies, in each language.
func TestRenderEmailChangeLinks(t *testing.T) {
	links := map[string]string{
		"email_change_old": "ConfirmLink",
		"email_change_new": "ConfirmLink",
		"email_changed":    "RevertLink",
	}
	for name, field := range links {
		for _, lang := range []string{"en", "ru"} {
			link := "https://example.com/" + name
			msg, err := Render(lang, name, map[string]any{"Name": "Alice", field: link, "NewEmail": "n•••@example.com"})
			if err != nil {
				t.Fatalf("%s.%s: %v", name, lang, err)
			}
			if !strings.Contains(msg.PlainBody, link) || !strings.Contains(msg.HTMLBody, `href="`+link+`"`) {
				t.Errorf("%s.%s: the link is missing from a body", name, lang)
			}
		}
	}
}
