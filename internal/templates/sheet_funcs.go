package templates

import (
	"encoding/json"
	"html/template"

	"charactersheet.iociveteres.net/internal/models"
)

// sheetStatePayload is the JSON the client builds the sheet state from.
type sheetStatePayload struct {
	Content      *models.CharacterSheetContent `json:"content"`
	RollDefaults rollDefaults                  `json:"rollDefaults"`
	CanEdit      bool                          `json:"canEdit"`
}

// rollDefaults are the roll settings a new attack or power starts with.
type rollDefaults struct {
	RangedAttack *models.RangedAttackRoll `json:"rangedAttack"`
	MeleeAttack  *models.MeleeAttackRoll  `json:"meleeAttack"`
	PsychicPower *models.PsychicPowerRoll `json:"psychicPower"`
	TechPower    *models.TechPowerRoll    `json:"techPower"`
}

// sheetState serializes the sheet for the #sheet-state script. The content is
// the struct the markup is rendered from. json.Marshal escapes <, > and &, so
// the output cannot close the script element.
func sheetState(content *models.CharacterSheetContent, canEdit bool) (template.JS, error) {
	payload := sheetStatePayload{
		Content: content,
		CanEdit: canEdit,
		RollDefaults: rollDefaults{
			RangedAttack: models.NewDefaultRangedAttackRoll(),
			MeleeAttack:  models.NewDefaultMeleeAttackRoll(),
			PsychicPower: models.NewDefaultPsychicPowerRoll(),
			TechPower:    models.NewDefaultTechPowerRoll(),
		},
	}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return template.JS(jsonData), nil
}
