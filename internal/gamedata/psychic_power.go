package gamedata

import "encoding/json"

type PsychicPower struct {
	CollectionEntry
	Type           string          `json:"type"`
	ExperienceCost *int            `json:"experienceCost,omitempty"`
	Requirements   json.RawMessage `json:"requirements,omitempty"`
	// Psychotest is the test text as the book writes it; the client builds the
	// roll from it at the pick (_prd/pathfinder_gamedata/spells.md).
	Psychotest string `json:"psychotest,omitempty"`
}

type PsychicPowerIndex = Index[PsychicPower, *PsychicPower]
