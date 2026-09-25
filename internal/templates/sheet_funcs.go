package templates

import (
	"encoding/json"
	"html/template"
	"strconv"

	"charactersheet.iociveteres.net/internal/models"
)

// SheetPayload is what the client renders a sheet from: the response of
// /sheet/view/:id and the #sheet-state script of a room page opened on a
// sheet (ui/static/js/sheet/main.ts).
type SheetPayload struct {
	// SheetID is a string, as the WebSocket messages about the sheet carry it.
	SheetID      string                        `json:"sheetId"`
	Kind         models.SheetKind              `json:"kind"`
	CanEdit      bool                          `json:"canEdit"`
	Content      *models.CharacterSheetContent `json:"content"`
	RollDefaults RollDefaults                  `json:"rollDefaults"`
}

// RollDefaults are the roll settings a new attack or power starts with.
type RollDefaults struct {
	RangedAttack *models.RangedAttackRoll `json:"rangedAttack"`
	MeleeAttack  *models.MeleeAttackRoll  `json:"meleeAttack"`
	PsychicPower *models.PsychicPowerRoll `json:"psychicPower"`
	TechPower    *models.TechPowerRoll    `json:"techPower"`
}

func NewSheetPayload(sheet *models.CharacterSheet, content *models.CharacterSheetContent, canEdit bool) SheetPayload {
	return SheetPayload{
		SheetID: strconv.Itoa(sheet.ID),
		Kind:    sheet.Kind,
		CanEdit: canEdit,
		Content: content,
		RollDefaults: RollDefaults{
			RangedAttack: models.NewDefaultRangedAttackRoll(),
			MeleeAttack:  models.NewDefaultMeleeAttackRoll(),
			PsychicPower: models.NewDefaultPsychicPowerRoll(),
			TechPower:    models.NewDefaultTechPowerRoll(),
		},
	}
}

// sheetState serializes the sheet of the page for the #sheet-state script.
// json.Marshal escapes <, > and &, so the output cannot close the script
// element.
func sheetState(data *Data) (template.JS, error) {
	jsonData, err := json.Marshal(NewSheetPayload(data.CharacterSheet, data.CharacterSheetContent, data.CanEditSheet))
	if err != nil {
		return "", err
	}
	return template.JS(jsonData), nil
}
