package gamedata

import (
	"embed"
	"encoding/json"
	"fmt"
)

// Catalog holds all loaded game data collections.
type Catalog struct {
	Advancements  *AdvancementIndex
	Gear          *GearIndex
	Cybernetics   *CyberneticsIndex
	Melee         *MeleeIndex
	PsychicPowers *PsychicPowerIndex
	Ranged        *RangedIndex
	TechPowers    *TechPowerIndex
	Collections   map[string]*CollectionIndex
}

//go:embed assets
var assetsFS embed.FS

var collectionFiles = map[string]string{
	"powerShields": "assets/power_shields.json",
	"talents":      "assets/talents.json",
	"traits":       "assets/traits.json",
}

func Load() (*Catalog, error) {
	c := &Catalog{
		Collections: make(map[string]*CollectionIndex),
	}

	typed := []struct {
		path string
		fn   func([]json.RawMessage) error
	}{
		{"assets/advancements.json", func(raws []json.RawMessage) error {
			idx, err := NewIndex[Advancement](raws)
			c.Advancements = idx
			return err
		}},
		{"assets/gear.json", func(raws []json.RawMessage) error {
			idx, err := NewIndex[Gear](raws)
			c.Gear = idx
			return err
		}},
		{"assets/cybernetics.json", func(raws []json.RawMessage) error {
			idx, err := NewIndex[Cybernetics](raws)
			c.Cybernetics = idx
			return err
		}},
		{"assets/melee.json", func(raws []json.RawMessage) error {
			idx, err := NewIndex[Melee](raws)
			c.Melee = idx
			return err
		}},
		{"assets/psychic_powers.json", func(raws []json.RawMessage) error {
			idx, err := NewIndex[PsychicPower](raws)
			c.PsychicPowers = idx
			return err
		}},
		{"assets/ranged.json", func(raws []json.RawMessage) error {
			idx, err := NewIndex[Ranged](raws)
			c.Ranged = idx
			return err
		}},
		{"assets/tech_powers.json", func(raws []json.RawMessage) error {
			idx, err := NewIndex[TechPower](raws)
			c.TechPowers = idx
			return err
		}},
	}

	for _, t := range typed {
		if err := loadInto(t.path, t.fn); err != nil {
			return nil, fmt.Errorf("load %s: %w", t.path, err)
		}
	}

	for name, path := range collectionFiles {
		if err := loadInto(path, func(raws []json.RawMessage) error {
			idx, err := NewIndex[CollectionEntry](raws)
			c.Collections[name] = idx
			return err
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
