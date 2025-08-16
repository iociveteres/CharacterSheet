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
	Sheet                   *models.Sheet
	Sheets                  []*models.Sheet
	CharacterSheets         []*models.CharacterSheet
	CharacterSheetSummaries []*models.CharacterSheetSummary
	Rooms                   []*models.Room
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
	cache := map[string]*template.Template{}
	pages1, err := fs.Glob(ui.Files, "html/pages/*.html")
	if err != nil {
		return nil, err
	}
	pages2, err := fs.Glob(ui.Files, "html/sheet/*.html")
	if err != nil {
		return nil, err
	}
	pages := append(pages1, pages2...)

	for _, page := range pages {
		name := filepath.Base(page)

		patterns := []string{
			"html/base.html",
			"html/partials/*.html",
			page,
		}

		ts, err := template.New(name).Funcs(functions).ParseFS(ui.Files, patterns...)
		if err != nil {
			return nil, err
		}

		cache[name] = ts
	}

	return cache, nil
}
