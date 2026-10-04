package templates

import (
	"encoding/json"
	"html/template"

	"charactersheet.iociveteres.net/internal/models"
)

// BestiaryPayload is what the /bestiary page renders from (#bestiary-state,
// ui/static/js/bestiary/main.tsx); the collections come over HTTP.
type BestiaryPayload struct {
	CSRFToken  string          `json:"csrfToken"`
	SheetKinds []RoomSheetKind `json:"sheetKinds"`
}

func NewBestiaryPayload(data *Data) BestiaryPayload {
	payload := BestiaryPayload{CSRFToken: data.CSRFToken, SheetKinds: make([]RoomSheetKind, 0, len(models.SheetKinds()))}
	for _, k := range models.SheetKinds() {
		payload.SheetKinds = append(payload.SheetKinds, RoomSheetKind{Kind: k.Kind, Label: k.Label})
	}
	return payload
}

func bestiaryState(data *Data) (template.JS, error) {
	jsonData, err := json.Marshal(NewBestiaryPayload(data))
	if err != nil {
		return "", err
	}
	return template.JS(jsonData), nil
}
