package templates

import (
	"encoding/json"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

// The room page embeds the sheet in a script element. It must survive any
// text in the content and carry what the client renders the sheet from.
func TestSheetStateEmbedsTheSheet(t *testing.T) {
	name := `</script><script>alert(1)</script> & "quotes"`
	rawName, _ := json.Marshal(name)
	sheet := &models.CharacterSheet{
		ID:      7,
		Kind:    models.KindPathfinderCrusade,
		Content: json.RawMessage(`{"characterInfo":{"characterName":` + string(rawName) + `},"size":2}`),
	}
	content, err := sheet.UnmarshalContent()
	if err != nil {
		t.Fatal(err)
	}

	js, err := sheetState(&Data{CharacterSheet: sheet, CharacterSheetContent: content, CanEditSheet: true})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(string(js)), "</script") {
		t.Fatalf("the payload can close its script element: %s", js)
	}

	var state struct {
		SheetID      string                       `json:"sheetId"`
		Kind         string                       `json:"kind"`
		CanEdit      bool                         `json:"canEdit"`
		Content      models.CharacterSheetContent `json:"content"`
		RollDefaults struct {
			RangedAttack models.RangedAttackRoll `json:"rangedAttack"`
			MeleeAttack  models.MeleeAttackRoll  `json:"meleeAttack"`
			PsychicPower models.PsychicPowerRoll `json:"psychicPower"`
			TechPower    models.TechPowerRoll    `json:"techPower"`
		} `json:"rollDefaults"`
	}
	if err := json.Unmarshal([]byte(js), &state); err != nil {
		t.Fatalf("the payload is not valid JSON: %v: %s", err, js)
	}

	if state.SheetID != "7" || state.Kind != "pathfinder_crusade" || !state.CanEdit {
		t.Errorf("sheetId, kind, canEdit = %q, %q, %v", state.SheetID, state.Kind, state.CanEdit)
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
