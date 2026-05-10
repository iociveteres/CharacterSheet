package gamedata

import "encoding/json"

type TechPower struct {
	CollectionEntry
	Type           string          `json:"type"`
	ExperienceCost *int            `json:"experienceCost,omitempty"`
	Requirements   json.RawMessage `json:"requirements,omitempty"`
}

type TechPowerIndex = Index[TechPower, *TechPower]
