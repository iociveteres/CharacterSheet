package gamedata

import "encoding/json"

// Advancement embeds CollectionEntry for name search and pass-through apply,
// and adds extra fields for rich frontend dropdown rendering.
// Used as Index[Advancement, *Advancement].
type Advancement struct {
	CollectionEntry
	Type           string          `json:"type"`
	ExperienceCost *int            `json:"experienceCost,omitempty"`
	Requirements   json.RawMessage `json:"requirements,omitempty"`
}

// AdvancementIndex is the type alias for Advancement's Index.
type AdvancementIndex = Index[Advancement, *Advancement]
