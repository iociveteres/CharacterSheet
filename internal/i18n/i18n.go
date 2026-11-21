// Package i18n translates the strings of the catalog in i18n/catalog (see _prd/i18n/plan.md).
package i18n

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"maps"
	"reflect"
	"sort"
	"strconv"
	"strings"

	catalogfs "charactersheet.iociveteres.net/i18n"
)

const Default = "en"

// Languages lists the supported languages, Default first.
var Languages = []string{"en", "ru"}

type Params map[string]any

// message is a plain text or, for a plural, the text of each form.
type message struct {
	text  string
	forms map[string]string
}

// catalog maps a key to its message in each language.
var catalog = mustLoad(catalogfs.Catalog)

func mustLoad(fsys fs.FS) map[string]map[string]message {
	c, err := load(fsys)
	if err != nil {
		panic(fmt.Sprintf("i18n: %v", err))
	}
	return c
}

func load(fsys fs.FS) (map[string]map[string]message, error) {
	c := map[string]map[string]message{}
	err := fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") {
			return err
		}
		b, err := fs.ReadFile(fsys, path)
		if err != nil {
			return err
		}
		var entries map[string]map[string]json.RawMessage
		if err := json.Unmarshal(b, &entries); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		for key, entry := range entries {
			byLang := map[string]message{}
			for _, lang := range Languages {
				raw, ok := entry[lang]
				if !ok {
					continue
				}
				var m message
				if err := json.Unmarshal(raw, &m.text); err != nil {
					if err := json.Unmarshal(raw, &m.forms); err != nil {
						return fmt.Errorf("%s: %s.%s is neither a string nor plural forms", path, key, lang)
					}
				}
				byLang[lang] = m
			}
			c[key] = byLang
		}
		return nil
	})
	return c, err
}

// T returns the message of key in lang, or in Default when lang has none; an unknown key
// comes back as is, so a missing entry shows up on the page instead of an empty string.
// A plural message picks its form by params "count".
func T(lang, key string, params ...Params) string {
	return translate(catalog, lang, key, params...)
}

func translate(c map[string]map[string]message, lang, key string, params ...Params) string {
	byLang, ok := c[key]
	if !ok {
		return key
	}
	m, ok := byLang[lang]
	if !ok {
		lang = Default
		m = byLang[lang]
	}
	var p Params
	if len(params) > 0 {
		p = params[0]
	}
	text := m.text
	if m.forms != nil {
		text, ok = m.forms[pluralForm(lang, toInt(p["count"]))]
		if !ok {
			text = m.forms["other"]
		}
	}
	for name, v := range p {
		value := fmt.Sprint(v)
		// Only count is a quantity for sure; a year, an id or "#1024" in another param stays as is.
		if rv := reflect.ValueOf(v); name == "count" && (rv.CanInt() || rv.CanUint()) {
			value = groupDigits(value)
		}
		text = strings.ReplaceAll(text, "{"+name+"}", value)
	}
	return text
}

// FormatCount writes a quantity as the param count of T does: from 1000 on, its thousands are
// set apart by a narrow no-break space (U+202F), "1 024", in every language. For a number shown
// without T, as "Posts: 1 024".
func FormatCount(n int) string {
	return groupDigits(strconv.Itoa(n))
}

// groupDigits sets the thousands of a decimal integer apart; ui/static/js/i18n formatCount does
// the same on the client.
func groupDigits(s string) string {
	sign := ""
	if strings.HasPrefix(s, "-") {
		sign, s = "-", s[1:]
	}
	if len(s) < 4 {
		return sign + s
	}
	var b strings.Builder
	b.WriteString(sign)
	for i, d := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteRune('\u202f')
		}
		b.WriteRune(d)
	}
	return b.String()
}

// TemplateT is "t" in the html templates of the site and of the forum: {{t .Lang "site.nav.rooms"}},
// params as name/value pairs: {{t .Lang "x.y" "count" 3}}.
func TemplateT(lang, key string, pairs ...any) (string, error) {
	if len(pairs)%2 != 0 {
		return "", fmt.Errorf("t %q: params must be name/value pairs", key)
	}
	params := Params{}
	for i := 0; i < len(pairs); i += 2 {
		name, ok := pairs[i].(string)
		if !ok {
			return "", fmt.Errorf("t %q: param name %v is not a string", key, pairs[i])
		}
		params[name] = pairs[i+1]
	}
	return T(lang, key, params), nil
}

// PluralForms returns the forms of the plural message key in lang, or in Default when lang has
// none, with {count} left in: for a script that picks the form itself (Intl.PluralRules).
// nil for an unknown key or a plain message.
func PluralForms(lang, key string) map[string]string {
	return pluralForms(catalog, lang, key)
}

func pluralForms(c map[string]map[string]message, lang, key string) map[string]string {
	m, ok := c[key][lang]
	if !ok {
		m = c[key][Default]
	}
	return maps.Clone(m.forms)
}

func toInt(v any) int64 {
	rv := reflect.ValueOf(v)
	switch {
	case rv.CanInt():
		return rv.Int()
	case rv.CanUint():
		return int64(rv.Uint())
	case rv.CanFloat():
		return int64(rv.Float())
	}
	return 0
}

// pluralForm follows the CLDR rules for integers: en one/other, ru one/few/many.
func pluralForm(lang string, n int64) string {
	if n < 0 {
		n = -n
	}
	if lang == "ru" {
		switch {
		case n%10 == 1 && n%100 != 11:
			return "one"
		case n%10 >= 2 && n%10 <= 4 && (n%100 < 12 || n%100 > 14):
			return "few"
		default:
			return "many"
		}
	}
	if n == 1 {
		return "one"
	}
	return "other"
}

func Supported(lang string) bool {
	for _, l := range Languages {
		if l == lang {
			return true
		}
	}
	return false
}

// FromAcceptLanguage picks the supported language the header ranks highest ("ru-RU" counts as
// "ru"), or Default.
func FromAcceptLanguage(header string) string {
	type ranged struct {
		lang string
		q    float64
	}
	var langs []ranged
	for _, part := range strings.Split(header, ",") {
		tag, rest, _ := strings.Cut(strings.TrimSpace(part), ";")
		q := 1.0
		if v, ok := strings.CutPrefix(strings.TrimSpace(rest), "q="); ok {
			parsed, err := strconv.ParseFloat(v, 64)
			if err != nil {
				continue
			}
			q = parsed
		}
		primary, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(tag)), "-")
		if q > 0 && Supported(primary) {
			langs = append(langs, ranged{primary, q})
		}
	}
	sort.SliceStable(langs, func(i, j int) bool { return langs[i].q > langs[j].q })
	if len(langs) == 0 {
		return Default
	}
	return langs[0].lang
}

type contextKey struct{}

func WithLang(ctx context.Context, lang string) context.Context {
	return context.WithValue(ctx, contextKey{}, lang)
}

// FromContext returns the language of the request, set by the language middleware of the
// web app, or Default.
func FromContext(ctx context.Context) string {
	if lang, ok := ctx.Value(contextKey{}).(string); ok {
		return lang
	}
	return Default
}
