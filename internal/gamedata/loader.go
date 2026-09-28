package gamedata

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"path"
	"slices"
)

// Catalog holds all loaded game data collections.
type Catalog struct {
	Advancements  *AdvancementIndex
	Conditions    *ConditionIndex
	Gear          *GearIndex
	Cybernetics   *CyberneticsIndex
	Melee         *MeleeIndex
	PsychicPowers *PsychicPowerIndex
	Ranged        *RangedIndex
	TechPowers    *TechPowerIndex
	Collections   map[string]*CollectionIndex

	// Warnings are asset problems Load worked around, for the caller to log.
	Warnings []string
}

//go:embed assets
var assetsFS embed.FS

var collectionFiles = map[string]string{
	"powerShields": "assets/power_shields.json",
	"talents":      "assets/talents.json",
	"traits":       "assets/traits.json",
}

// Load reads the embedded assets. Bad asset content never fails it: the
// assets come from another repo at deploy time, so a broken file or entry is
// left out and described in Warnings instead.
func Load() *Catalog {
	return loadFrom(assetsFS)
}

func loadFrom(fsys fs.FS) *Catalog {
	c := &Catalog{
		Collections: make(map[string]*CollectionIndex),
	}

	c.loadInto(fsys, "assets/advancements.json", into(&c.Advancements))
	c.loadInto(fsys, "assets/conditions.json", into(&c.Conditions))
	c.loadInto(fsys, "assets/gear.json", into(&c.Gear))
	c.loadInto(fsys, "assets/cybernetics.json", into(&c.Cybernetics))
	c.loadInto(fsys, "assets/melee.json", into(&c.Melee))
	c.loadInto(fsys, "assets/psychic_powers.json", into(&c.PsychicPowers))
	c.loadInto(fsys, "assets/ranged.json", into(&c.Ranged))
	c.loadInto(fsys, "assets/tech_powers.json", into(&c.TechPowers))

	// Sorted so the warnings come in the same order on every start.
	for _, name := range slices.Sorted(maps.Keys(collectionFiles)) {
		c.loadInto(fsys, collectionFiles[name], func(raws []json.RawMessage) []error {
			idx, skipped := NewIndex[CollectionEntry](raws)
			c.Collections[name] = idx
			return skipped
		})
	}

	c.Warnings = append(c.Warnings, conditionWarnings("conditions.json", c.Conditions)...)
	c.Warnings = append(c.Warnings, conditionWarnings("gear.json", c.Gear)...)
	c.Warnings = append(c.Warnings, conditionWarnings("cybernetics.json", c.Cybernetics)...)

	return c
}

// into returns a build func for loadInto that stores the index in *dst.
func into[T any, PT interface {
	*T
	indexable
}](dst **Index[T, PT]) func([]json.RawMessage) []error {
	return func(raws []json.RawMessage) []error {
		idx, skipped := NewIndex[T, PT](raws)
		*dst = idx
		return skipped
	}
}

// loadInto decodes the JSON array at p and passes its elements to build.
// A missing file is skipped silently. A file that can't be read or isn't an
// array is skipped with a warning and build is not called, so its collection
// stays as if the file were missing.
func (c *Catalog) loadInto(fsys fs.FS, p string, build func([]json.RawMessage) []error) {
	file := path.Base(p)
	f, err := fsys.Open(p)
	if errors.Is(err, fs.ErrNotExist) {
		return
	}
	if err != nil {
		c.Warnings = append(c.Warnings, fmt.Sprintf("%s: skipped the file: %v", file, err))
		return
	}
	defer f.Close()

	var raws []json.RawMessage
	if err := json.NewDecoder(f).Decode(&raws); err != nil {
		c.Warnings = append(c.Warnings, fmt.Sprintf("%s: skipped the file: %v", file, err))
		return
	}
	for _, err := range build(raws) {
		c.Warnings = append(c.Warnings, fmt.Sprintf("%s: skipped %v", file, err))
	}
}
