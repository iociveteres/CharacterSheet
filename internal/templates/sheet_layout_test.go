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
	return renderSheetFragmentWithContent(t, kind, `{"characterInfo":{"characterName":"Test Character"}}`)
}

func renderSheetFragmentWithContent(t *testing.T, kind models.SheetKind, rawContent string) (string, error) {
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
		Content:       json.RawMessage(rawContent),
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

// The client builds the sheet state from #sheet-state. It must sit outside the
// shadow root template and survive any text in the content.
func TestSheetFragmentEmbedsState(t *testing.T) {
	name := `</script><script>alert(1)</script> & "quotes"`
	rawName, _ := json.Marshal(name)
	body, err := renderSheetFragmentWithContent(t, models.KindBlackCrusade,
		`{"characterInfo":{"characterName":`+string(rawName)+`},"size":2}`)
	if err != nil {
		t.Fatal(err)
	}

	const open = `<script id="sheet-state" type="application/json">`
	start := strings.Index(body, open)
	if start < 0 {
		t.Fatal("fragment has no #sheet-state script")
	}
	if templateEnd := strings.Index(body, "</template>"); templateEnd < 0 || start < templateEnd {
		t.Error("#sheet-state is inside the shadow root template")
	}
	end := strings.Index(body[start:], "</script>")
	if end < 0 {
		t.Fatal("#sheet-state is not closed")
	}
	raw := body[start+len(open) : start+end]

	var state struct {
		Content      models.CharacterSheetContent `json:"content"`
		RollDefaults struct {
			RangedAttack models.RangedAttackRoll `json:"rangedAttack"`
			MeleeAttack  models.MeleeAttackRoll  `json:"meleeAttack"`
			PsychicPower models.PsychicPowerRoll `json:"psychicPower"`
			TechPower    models.TechPowerRoll    `json:"techPower"`
		} `json:"rollDefaults"`
	}
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		t.Fatalf("#sheet-state is not valid JSON: %v: %s", err, raw)
	}

	if state.Content.CharacterInfo.CharacterName != name {
		t.Errorf("characterName = %q, want %q", state.Content.CharacterInfo.CharacterName, name)
	}
	if state.Content.Size != 2 {
		t.Errorf("size = %d, want 2", state.Content.Size)
	}
	if got, want := state.RollDefaults.RangedAttack, *models.NewDefaultRangedAttackRoll(); got != want {
		t.Errorf("rangedAttack roll defaults = %+v, want %+v", got, want)
	}
	if got, want := state.RollDefaults.TechPower, *models.NewDefaultTechPowerRoll(); got != want {
		t.Errorf("techPower roll defaults = %+v, want %+v", got, want)
	}
}
