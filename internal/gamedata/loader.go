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

	if err := loadInto("assets/advancements.json", func(raws []json.RawMessage) error {
		idx, err := NewIndex[Advancement](raws)
		if err != nil {
			return err
		}
		c.Advancements = idx
		return nil
	}); err != nil {
		return nil, fmt.Errorf("advancements: %w", err)
	}

	for name, path := range collectionFiles {
		if err := loadInto(path, func(raws []json.RawMessage) error {
			idx, err := NewIndex[CollectionEntry](raws)
			if err != nil {
				return err
			}
			c.Collections[name] = idx
			return nil
		}); err != nil {
			return nil, fmt.Errorf("collection %s: %w", name, err)
		}
	}

	return c, nil
}

// loadInto opens a path from the embedded FS, decodes it as []json.RawMessage,
// and calls fn with the result. Missing files are silently skipped.
func loadInto(path string, fn func([]json.RawMessage) error) error {
	f, err := assetsFS.Open(path)
	if err != nil {
		return nil // absent file is not an error
	}
	defer f.Close()

	var raws []json.RawMessage
	if err := json.NewDecoder(f).Decode(&raws); err != nil {
		return err
	}
	return fn(raws)
}
