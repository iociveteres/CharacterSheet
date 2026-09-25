package templates

import (
	"fmt"
	"html/template"
	"io/fs"
	"maps"
	"path"
	"path/filepath"

	"charactersheet.iociveteres.net/internal/mailer"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/internal/util"
	"charactersheet.iociveteres.net/ui"
	"github.com/alehano/reverse"
)

var functions = template.FuncMap{
	"humanDate":                humanDate,
	"formatOnlineCount":        formatOnlineCount,
	"layoutPsychicPowers":      columnsFromLayoutPsychicPowers,
	"layoutTechPowers":         columnsFromLayoutTechPowers,
	"layoutPsychicTabs":        columnsFromLayoutPsychicTabs,
	"layoutTechTabs":           columnsFromLayoutTechTabs,
	"sheetState":               sheetState,
	"psychicPowerWithDefaults": psychicPowerWithDefaults,
	"techPowerWithDefaults":    techPowerWithDefaults,
	"dict":                     dict,
	"sheetKinds":               models.SheetKinds,
	"unknownSheetKind":         unknownSheetKind,
	"makeInviteLink":           util.MakeInviteLink,
	"reverseRev":               reverse.Rev,
	"isElevated":               isElevated,
	"isGamemaster":             isGamemaster,
	"rfc3339":                  rfc3399,
	"str":                      str,
	"importMapJSON":            func() template.HTML { return template.HTML(ui.ImportMapJSON()) },
}

// unknownSheetKind fails rendering for a kind the sheet template has no branch
// for, instead of silently falling back to another layout.
func unknownSheetKind(kind models.SheetKind) (string, error) {
	return "", fmt.Errorf("no sheet layout for kind %q", kind)
}

func NewTemplateCache() (map[string]*template.Template, error) {
	maps.Copy(functions, ui.VersionFunc())

	root, err := template.
		New("root").
		Funcs(functions).
		ParseFS(ui.Files,
			"html/base.html",
			"html/partials/*.html",
			"html/sheet/*.html",
			"html/kinds/*.html",
			"html/pages/*.html",
		)
	if err != nil {
		return nil, err
	}

	cache := map[string]*template.Template{}
	templatePages, _ := fs.Glob(ui.Files, "html/pages/*.html")
	for _, page := range templatePages {
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

	mailPages, _ := fs.Glob(mailer.Templates, "templates/*.html")
	for _, page := range mailPages {
		name := path.Base(page)
		ts, err := root.Clone()
		if err != nil {
			return nil, err
		}
		if _, err := ts.ParseFS(mailer.Templates, page); err != nil {
			return nil, err
		}
		cache["mail/"+name] = ts
	}

	return cache, nil
}
