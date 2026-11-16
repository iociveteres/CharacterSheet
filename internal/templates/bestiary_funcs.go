package templates

import (
	"encoding/json"
	"html/template"
)

// BestiaryPayload is what the /bestiary page renders from (#bestiary-state,
// ui/static/js/bestiary/main.tsx); the collections come over HTTP.
type BestiaryPayload struct {
	CSRFToken  string          `json:"csrfToken"`
	SheetKinds []RoomSheetKind `json:"sheetKinds"`
}

func NewBestiaryPayload(data *Data) BestiaryPayload {
	return BestiaryPayload{CSRFToken: data.CSRFToken, SheetKinds: roomSheetKinds(data.Lang)}
}

func bestiaryState(data *Data) (template.JS, error) {
	jsonData, err := json.Marshal(NewBestiaryPayload(data))
	if err != nil {
		return "", err
	}
	return template.JS(jsonData), nil
}
