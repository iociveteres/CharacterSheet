package webapp

import (
	"mime"
	"net/http/httptest"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

func TestDownloadNames(t *testing.T) {
	for name, fallback := range map[string]string{
		"Orks_2026-11-17_15-04-05.json":         "Orks_2026-11-17_15-04-05.json",
		"Мои существа_2026-11-17_15-04-05.json": "___ _________2026-11-17_15-04-05.json",
		`Say "Waaagh!" \ (twice); 50%=ok.json`:  `Say _Waaagh!_ _ (twice); 50%=ok.json`,
	} {
		rec := httptest.NewRecorder()
		setDownload(rec, name)
		header := rec.Header().Get("Content-Disposition")
		// mime reads filename* the way a browser does and prefers it.
		disposition, params, err := mime.ParseMediaType(header)
		if err != nil {
			t.Fatalf("%s: %q: %v", name, header, err)
		}
		assert.Equal(t, disposition, "attachment")
		assert.Equal(t, params["filename"], name)
		assert.StringContains(t, header, `filename="`+fallback+`"`)
	}
}
