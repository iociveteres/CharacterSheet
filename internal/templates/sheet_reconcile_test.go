package templates

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

// dumpedSheet is one line of the sheet dump read by
// TestRenderSheetsForReconcile, produced with
//
//	psql "$DATABASE_URL" -Atc "select json_build_object('id', id, 'kind', sheet_kind, 'content', content) from character_sheets" > sheets.jsonl
type dumpedSheet struct {
	ID      int              `json:"id"`
	Kind    models.SheetKind `json:"kind"`
	Content json.RawMessage  `json:"content"`
}

// An entry of unrendered.json, read by scripts/reconcile/compare.ts.
type unrenderedSheet struct {
	ID    int    `json:"id"`
	Error string `json:"error"`
}

// TestRenderSheetsForReconcile renders the sheet fragment for every sheet in
// a dump, the way sheetView does, so that scripts/reconcile-sheets.mjs can
// compare the state scanned from the markup with the state built from the
// embedded JSON. It only runs when SHEET_RECONCILE_DUMP (the JSONL dump) and
// SHEET_RECONCILE_OUT (the output directory) are set. Sheets that do not
// unmarshal or render go to unrendered.json instead of failing the test.
func TestRenderSheetsForReconcile(t *testing.T) {
	dumpPath := os.Getenv("SHEET_RECONCILE_DUMP")
	outDir := os.Getenv("SHEET_RECONCILE_OUT")
	if dumpPath == "" || outDir == "" {
		t.Skip("SHEET_RECONCILE_DUMP and SHEET_RECONCILE_OUT are not set")
	}

	cache, err := NewTemplateCache()
	if err != nil {
		t.Fatal(err)
	}
	ts := cache["charactersheet_template.html"]

	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatal(err)
	}

	f, err := os.Open(dumpPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 1<<20), 64<<20)
	rendered := 0
	unrendered := []unrenderedSheet{}
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}

		var dumped dumpedSheet
		if err := json.Unmarshal(line, &dumped); err != nil {
			t.Fatalf("parsing dump line: %v", err)
		}
		if dumped.Kind == "" {
			dumped.Kind = models.DefaultSheetKind
		}

		sheet := &models.CharacterSheet{ID: dumped.ID, Kind: dumped.Kind, Content: dumped.Content}
		content, err := sheet.UnmarshalContent()
		if err != nil {
			unrendered = append(unrendered, unrenderedSheet{dumped.ID, err.Error()})
			continue
		}

		buf := &bytes.Buffer{}
		err = ts.ExecuteTemplate(buf, "character_sheet_fragment", &Data{
			CharacterSheet:        sheet,
			CharacterSheetContent: content,
			CanEditSheet:          true,
		})
		if err != nil {
			unrendered = append(unrendered, unrenderedSheet{dumped.ID, "rendering: " + err.Error()})
			continue
		}

		name := filepath.Join(outDir, fmt.Sprintf("%d.html", dumped.ID))
		if err := os.WriteFile(name, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
		rendered++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}

	list, err := json.Marshal(unrendered)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outDir, "unrendered.json"), list, 0o644); err != nil {
		t.Fatal(err)
	}

	t.Logf("rendered %d sheets into %s, %d not rendered", rendered, outDir, len(unrendered))
}
