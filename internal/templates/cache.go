package templates

import (
	"fmt"
	"html/template"
	"io/fs"
	"maps"
	"path"
	"strings"

	"charactersheet.iociveteres.net/internal/i18n"
	"charactersheet.iociveteres.net/internal/util"
	"charactersheet.iociveteres.net/ui"
	"github.com/alehano/reverse"
)

var functions = template.FuncMap{
	"humanDate":         humanDate,
	"formatOnlineCount": formatOnlineCount,
	"onlineCountForms":  onlineCountForms,
	"sheetState":        sheetState,
	"roomState":         roomState,
	"bestiaryState":     bestiaryState,
	"dict":              dict,
	"makeInviteLink":    util.MakeInviteLink,
	"reverseRev":        reverse.Rev,
	"isElevated":        isElevated,
	"isGamemaster":      isGamemaster,
	"str":               str,
	"t":                 translate,
}

// NewTemplateCache returns the page templates by language, then by file name of the page.
func NewTemplateCache() (map[string]map[string]*template.Template, error) {
	return newTemplateCache(ui.Files)
}

// newTemplateCache builds a set of templates for each language because html/template can't
// pick a template by a name known only at execution: html/content/<name>.<lang>.html becomes
// the template "content/<name>" of its language, <name>.en.html where the language has none.
func newTemplateCache(files fs.FS) (map[string]map[string]*template.Template, error) {
	maps.Copy(functions, ui.VersionFunc())

	root, err := template.
		New("root").
		Funcs(functions).
		ParseFS(files,
			"html/base.html",
			"html/partials/*.html",
			"html/pages/*.html",
		)
	if err != nil {
		return nil, err
	}

	// content name -> language -> file
	contents := map[string]map[string]string{}
	contentFiles, _ := fs.Glob(files, "html/content/*.html")
	for _, file := range contentFiles {
		name, lang, ok := strings.Cut(strings.TrimSuffix(path.Base(file), ".html"), ".")
		if !ok || !i18n.Supported(lang) {
			return nil, fmt.Errorf("%s: want <name>.<lang>.html with a language of %v", file, i18n.Languages)
		}
		if contents[name] == nil {
			contents[name] = map[string]string{}
		}
		contents[name][lang] = file
	}

	templatePages, _ := fs.Glob(files, "html/pages/*.html")

	cache := map[string]map[string]*template.Template{}
	for _, lang := range i18n.Languages {
		langRoot, err := root.Clone()
		if err != nil {
			return nil, err
		}
		for name, byLang := range contents {
			file, ok := byLang[lang]
			if !ok {
				file, ok = byLang[i18n.Default]
			}
			if !ok {
				return nil, fmt.Errorf("content %s has no %s file", name, i18n.Default)
			}
			b, err := fs.ReadFile(files, file)
			if err != nil {
				return nil, err
			}
			if _, err := langRoot.New("content/" + name).Parse(string(b)); err != nil {
				return nil, fmt.Errorf("%s: %w", file, err)
			}
		}

		pages := map[string]*template.Template{}
		for _, page := range templatePages {
			ts, err := langRoot.Clone()
			if err != nil {
				return nil, err
			}
			if _, err := ts.ParseFS(files, page); err != nil {
				return nil, err
			}
			pages[path.Base(page)] = ts
		}
		cache[lang] = pages
	}

	return cache, nil
}
