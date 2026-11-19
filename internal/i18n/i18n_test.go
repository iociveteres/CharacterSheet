package i18n

import (
	"context"
	"testing"
	"testing/fstest"

	"charactersheet.iociveteres.net/internal/assert"
)

func fixture(t *testing.T) map[string]map[string]message {
	t.Helper()
	c, err := load(fstest.MapFS{
		"catalog/test.json": {Data: []byte(`{
  "test.greet": { "en": "Hello, {name}!", "ru": "Привет, {name}!", "note": "for the translator" },
  "test.onlyEn": { "en": "English only" },
  "test.dice": { "en": {"one": "{count} die", "other": "{count} dice"},
                 "ru": {"one": "{count} кубик", "few": "{count} кубика", "many": "{count} кубиков"} },
  "test.diceEn": { "en": {"one": "{count} die", "other": "{count} dice"} }
}`)},
	})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestTranslate(t *testing.T) {
	c := fixture(t)
	tests := []struct {
		name, lang, key string
		params          Params
		want            string
	}{
		{"substitution en", "en", "test.greet", Params{"name": "Alice"}, "Hello, Alice!"},
		{"substitution ru", "ru", "test.greet", Params{"name": "Алиса"}, "Привет, Алиса!"},
		{"no params keeps the placeholder", "en", "test.greet", nil, "Hello, {name}!"},
		{"missing ru falls back to en", "ru", "test.onlyEn", nil, "English only"},
		{"unsupported language falls back to en", "de", "test.greet", Params{"name": "A"}, "Hello, A!"},
		{"unknown key comes back as is", "ru", "test.nope", nil, "test.nope"},
		{"en plural one", "en", "test.dice", Params{"count": 1}, "1 die"},
		{"en plural other", "en", "test.dice", Params{"count": 2}, "2 dice"},
		{"fallback to en uses the en plural rule", "ru", "test.diceEn", Params{"count": 2}, "2 dice"},
		{"count of another integer type", "ru", "test.dice", Params{"count": uint8(3)}, "3 кубика"},
		{"a count from 1000 is grouped", "en", "test.dice", Params{"count": 1024}, "1\u202f024 dice"},
		{"a count picks its form before grouping", "ru", "test.dice", Params{"count": 4522}, "4\u202f522 кубика"},
		{"another param is not grouped", "en", "test.greet", Params{"name": 2026}, "Hello, 2026!"},
		{"a fractional count is not grouped", "en", "test.dice", Params{"count": 1500.5}, "1500.5 dice"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got string
			if tt.params == nil {
				got = translate(c, tt.lang, tt.key)
			} else {
				got = translate(c, tt.lang, tt.key, tt.params)
			}
			assert.Equal(t, got, tt.want)
		})
	}
}

func TestFormatCount(t *testing.T) {
	for n, want := range map[int]string{
		0:          "0",
		999:        "999",
		1000:       "1\u202f000",
		1024:       "1\u202f024",
		-4512:      "-4\u202f512",
		123456:     "123\u202f456",
		1234567:    "1\u202f234\u202f567",
		-100000000: "-100\u202f000\u202f000",
	} {
		assert.Equal(t, FormatCount(n), want)
	}
}

func TestRussianPlural(t *testing.T) {
	c := fixture(t)
	for n, want := range map[int]string{
		1:   "1 кубик",
		2:   "2 кубика",
		5:   "5 кубиков",
		11:  "11 кубиков",
		12:  "12 кубиков",
		21:  "21 кубик",
		22:  "22 кубика",
		25:  "25 кубиков",
		111: "111 кубиков",
		0:   "0 кубиков",
	} {
		assert.Equal(t, translate(c, "ru", "test.dice", Params{"count": n}), want)
	}
}

func TestPluralForms(t *testing.T) {
	c := fixture(t)
	assert.Equal(t, pluralForms(c, "ru", "test.dice")["few"], "{count} кубика")
	assert.Equal(t, pluralForms(c, "ru", "test.diceEn")["other"], "{count} dice")
	assert.Equal(t, len(pluralForms(c, "en", "test.greet")), 0)
	assert.Equal(t, len(pluralForms(c, "en", "test.nope")), 0)
}

func TestCatalogLoads(t *testing.T) {
	en, ru := T("en", "common.close"), T("ru", "common.close")
	if en == "common.close" || ru == "common.close" || en == ru {
		t.Errorf("common.close is %q in en, %q in ru: the catalog did not load both", en, ru)
	}
}

func TestFromAcceptLanguage(t *testing.T) {
	tests := map[string]string{
		"":                                    "en",
		"ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7": "ru",
		"en-US,en;q=0.9,ru;q=0.8":             "en",
		"de-DE,ru;q=0.5":                      "ru",
		"de, fr;q=0.8":                        "en",
		"en;q=0.5, ru;q=0.9":                  "ru",
		"RU":                                  "ru",
		"ru;q=0, en;q=0.1":                    "en",
		"*":                                   "en",
	}
	for header, want := range tests {
		assert.Equal(t, FromAcceptLanguage(header), want)
	}
}

func TestFromContext(t *testing.T) {
	assert.Equal(t, FromContext(context.Background()), Default)
	assert.Equal(t, FromContext(WithLang(context.Background(), "ru")), "ru")
}

// The t of the templates takes params as name/value pairs.
func TestTemplateT(t *testing.T) {
	got, err := TemplateT("ru", "site.home.online.count", "count", 21)
	assert.NilError(t, err)
	assert.StringContains(t, got, "21")
	_, err = TemplateT("ru", "common.close", "count")
	assert.NotNilError(t, err)
	_, err = TemplateT("ru", "common.close", 1, 2)
	assert.NotNilError(t, err)
}
