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

var functions = template.FuncMap{
	"humanDate": humanDate,
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
