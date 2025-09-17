package main

import (
	"html/template"
	"io/fs"
	"path/filepath"
	"time"

	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/ui"
)

type templateData struct {
	CurrentYear             int
	CharacterSheet          *models.CharacterSheet
	CharacterSheets         []*models.CharacterSheet
	CharacterSheetSummaries []*models.CharacterSheetSummary
	CharacterSheetContent   *models.CharacterSheetContent
	Room                    *models.Room
	Rooms                   []*models.Room
	PlayerViews             []*models.PlayerView
	Form                    any
	Flash                   string
	IsAuthenticated         bool
	CSRFToken               string
	User                    *models.User
	HideLayout              bool
}

func humanDate(t time.Time) string {
	if t.IsZero() {
		return ""
	}

	return t.UTC().Format("02 Jan 2006 at 15:04")
}

func dict(values ...interface{}) map[string]interface{} {
	m := make(map[string]interface{}, len(values)/2)
	for i := 0; i < len(values); i += 2 {
		k, ok := values[i].(string)
		if !ok || i+1 >= len(values) {
			continue
		}
		m[k] = values[i+1]
	}
	return m
}

var functions = template.FuncMap{
	"humanDate": humanDate,
	"dict":                    dict,
}

func newTemplateCache() (map[string]*template.Template, error) {
	root, err := template.
		New("root").
		Funcs(functions).
		ParseFS(ui.Files,
			"html/base.html",
			"html/partials/*.html",
			"html/sheet/*.html",
			"html/pages/*.html",
		)
	if err != nil {
		return nil, err
	}

	cache := map[string]*template.Template{}
	pages, _ := fs.Glob(ui.Files, "html/pages/*.html")
	for _, page := range pages {
		name := filepath.Base(page)
		ts, err := root.Clone()
		if err != nil {
			return nil, err
		}
		if _, err := ts.ParseFS(ui.Files, page); err != nil {
			return nil, err
		}
		cache[name] = ts
	}

	return cache, nil
}
