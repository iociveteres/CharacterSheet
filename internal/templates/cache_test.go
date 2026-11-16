package templates

import (
	"bytes"
	"testing"
	"testing/fstest"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestTemplateCacheContentByLanguage(t *testing.T) {
	files := fstest.MapFS{
		"html/base.html":            {Data: []byte(`{{define "base"}}<html lang='{{.Lang}}'>{{template "main" .}}</html>{{end}}`)},
		"html/partials/nav.html":    {Data: []byte(`{{define "nav"}}{{end}}`)},
		"html/pages/page.html":      {Data: []byte(`{{define "main"}}{{template "content/both" .}} {{template "content/enOnly" .}}{{end}}`)},
		"html/content/both.en.html": {Data: []byte(`Hello`)},
		"html/content/both.ru.html": {Data: []byte(`Привет`)},
		// No ru file: the ru page takes this one.
		"html/content/enOnly.en.html": {Data: []byte(`only {{.Lang}}`)},
	}
	cache, err := newTemplateCache(files)
	if err != nil {
		t.Fatal(err)
	}
	for lang, want := range map[string]string{
		"en": "<html lang='en'>Hello only en</html>",
		"ru": "<html lang='ru'>Привет only ru</html>",
	} {
		buf := new(bytes.Buffer)
		if err := cache[lang]["page.html"].ExecuteTemplate(buf, "base", &Data{Lang: lang}); err != nil {
			t.Fatal(err)
		}
		assert.Equal(t, buf.String(), want)
	}
}

func TestTemplateCacheContentWithoutEnglish(t *testing.T) {
	files := fstest.MapFS{
		"html/base.html":              {Data: []byte(`{{define "base"}}{{end}}`)},
		"html/partials/nav.html":      {Data: []byte(`{{define "nav"}}{{end}}`)},
		"html/pages/page.html":        {Data: []byte(`{{define "main"}}{{end}}`)},
		"html/content/ruOnly.ru.html": {Data: []byte(`Привет`)},
	}
	if _, err := newTemplateCache(files); err == nil {
		t.Error("content without an en file was accepted")
	}
}

func TestTranslateFunc(t *testing.T) {
	got, err := translate("ru", "common.close")
	assert.NilError(t, err)
	assert.Equal(t, got, "Закрыть")
	_, err = translate("ru", "common.close", "count")
	assert.NotNilError(t, err)
}
