package templates

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

// renderSheetFragment renders the sheet fragment for a kind, the way
// webapp.sheetView does.
func renderSheetFragment(t *testing.T, kind models.SheetKind) (string, error) {
	t.Helper()

	cache, err := NewTemplateCache()
	if err != nil {
		t.Fatal(err)
	}

	ts, ok := cache["charactersheet_template.html"]
	if !ok {
		t.Fatal("charactersheet_template.html missing from template cache")
	}

	sheet := &models.CharacterSheet{
		ID:            1,
		CharacterName: "Test Character",
		Kind:          kind,
		Content:       json.RawMessage(`{"characterInfo":{"characterName":"Test Character"}}`),
	}
	content, err := sheet.UnmarshalContent()
	if err != nil {
		t.Fatal(err)
	}

	buf := &bytes.Buffer{}
	err = ts.ExecuteTemplate(buf, "character_sheet_fragment", &Data{
		CharacterSheet:        sheet,
		CharacterSheetContent: content,
		CanEditSheet:          true,
	})
	return buf.String(), err
}

// Every registered kind needs a layout branch in charactersheet_template.html.
func TestSheetFragmentRendersEveryKind(t *testing.T) {
	for _, info := range models.SheetKinds() {
		t.Run(string(info.Kind), func(t *testing.T) {
			body, err := renderSheetFragment(t, info.Kind)
			if err != nil {
				t.Fatalf("rendering kind %q: %v", info.Kind, err)
			}
			if !strings.Contains(body, `data-sheet-kind="`+string(info.Kind)+`"`) {
				t.Errorf("rendered sheet does not carry data-sheet-kind=%q", info.Kind)
			}
			if !strings.Contains(body, `id="navigation-tabs"`) {
				t.Errorf("rendered sheet for kind %q has no layout", info.Kind)
			}
		})
	}
}

// A kind without a layout branch must fail loudly instead of falling back to
// another kind's layout.
func TestSheetFragmentFailsForUnknownKind(t *testing.T) {
	_, err := renderSheetFragment(t, models.SheetKind("great_crusade"))
	if err == nil {
		t.Fatal("expected an error for an unknown sheet kind, got nil")
	}
}
