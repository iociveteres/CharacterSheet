package forum

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const module = "charactersheet.iociveteres.net/"

// The packages of the project that the forum may import: libraries that know nothing of sheets,
// rooms or the web app. A new one goes here after the check by the import rule of
// _prd/forum/plan.md («Граница с приложением»).
var allowedImports = map[string]bool{
	module + "internal/i18n":      true,
	module + "internal/util":      true,
	module + "internal/validator": true,
	module + "internal/assert":    true,
}

func TestImportsOnlyLibraries(t *testing.T) {
	err := filepath.WalkDir(".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, spec := range file.Imports {
			imp, err := strconv.Unquote(spec.Path.Value)
			if err != nil {
				return err
			}
			own := strings.HasPrefix(imp, module+"internal/forum")
			if strings.HasPrefix(imp, module) && !own && !allowedImports[imp] {
				t.Errorf("%s imports %s, not in allowedImports", path, imp)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
