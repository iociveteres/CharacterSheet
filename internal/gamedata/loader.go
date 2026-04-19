package gamedata

import (
	"embed"
	"encoding/json"
	"fmt"
)

// Catalog holds all loaded game data collections.
type Catalog struct {
	Advancements *AdvancementIndex
}

//go:embed assets
var assetsFS embed.FS

func Load() (*Catalog, error) {
	c := &Catalog{}

	f, err := assetsFS.Open("assets/advancements.json")
	if err != nil {
		// File absent from embedded FS — advancements simply unavailable
		return c, nil
	}
	defer f.Close()

	var raws []json.RawMessage
	if err := json.NewDecoder(f).Decode(&raws); err != nil {
		return nil, fmt.Errorf("advancements: %w", err)
	}

	idx, err := newAdvancementIndex(raws)
	if err != nil {
		return nil, fmt.Errorf("advancements: build index: %w", err)
	}
	c.Advancements = idx

	return c, nil
}
