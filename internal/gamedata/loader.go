package gamedata

import (
	"embed"
	"encoding/json"
	"fmt"
)

// Catalog holds all loaded game data collections.
type Catalog struct {
	Advancements *AdvancementIndex
	Collections  map[string]*CollectionIndex
}

//go:embed assets
var assetsFS embed.FS

// collectionFiles maps the collection name used in WebSocket messages
// to its asset path. Absent files are silently skipped.
var collectionFiles = map[string]string{
	"cybernetics":   "assets/cybernetics.json",
	"gear":          "assets/gear.json",
	"melee":         "assets/melee.json",
	"powerShields":  "assets/power_shields.json",
	"psychicPowers": "assets/psychic_powers.json",
	"ranged":        "assets/ranged.json",
	"talents":       "assets/talents.json",
	"techPowers":    "assets/tech_powers.json",
	"traits":        "assets/traits.json",
}

func Load() (*Catalog, error) {
	c := &Catalog{
		Collections: make(map[string]*CollectionIndex),
	}

	// Load advancements (keeps its own typed index for type-field remapping).
	f, err := assetsFS.Open("assets/advancements.json")
	if err == nil {
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
	}

	// Load generic pass-through collections.
	for name, path := range collectionFiles {
		f, err := assetsFS.Open(path)
		if err != nil {
			// File absent from embedded FS — collection simply unavailable.
			continue
		}
		var raws []json.RawMessage
		if err := json.NewDecoder(f).Decode(&raws); err != nil {
			f.Close()
			return nil, fmt.Errorf("collection %s: %w", name, err)
		}
		f.Close()

		idx, err := newCollectionIndex(raws)
		if err != nil {
			return nil, fmt.Errorf("collection %s: build index: %w", name, err)
		}
		c.Collections[name] = idx
	}

	return c, nil
}