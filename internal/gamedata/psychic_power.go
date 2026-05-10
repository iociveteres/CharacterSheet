package gamedata

import "encoding/json"

type PsychicPower struct {
	CollectionEntry
	Type           string          `json:"type"`
	ExperienceCost *int            `json:"experienceCost,omitempty"`
	Requirements   json.RawMessage `json:"requirements,omitempty"`
}

type PsychicPowerIndex = Index[PsychicPower, *PsychicPower]
