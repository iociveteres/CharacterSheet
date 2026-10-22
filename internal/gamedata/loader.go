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
	"strings"

	"charactersheet.iociveteres.net/internal/models"
)

// Catalogs holds a catalog for every sheet kind. A sheet of one kind never
// gets entries of another (_prd/pathfinder_gamedata/spells.md).
type Catalogs map[models.SheetKind]*Catalog

// Catalog holds all loaded game data collections of one sheet kind.
type Catalog struct {
	Advancements  *AdvancementIndex
	Conditions    *ConditionIndex
	Gear          *GearIndex
	ArmourMods    *ArmourModIndex
	Cybernetics   *CyberneticsIndex
	Melee         *MeleeIndex
	PsychicPowers *PsychicPowerIndex
	Ranged        *RangedIndex
	WeaponMods    *WeaponModIndex
	TechPowers    *TechPowerIndex
	Collections   map[string]*CollectionIndex

	// Warnings are asset problems Load worked around, for the caller to log.
	Warnings []string
}

//go:embed assets
var assetsFS embed.FS

var collectionFiles = map[string]string{
	"powerShields": "power_shields.json",
	"talents":      "talents.json",
	"traits":       "traits.json",
}

// Load reads the embedded assets. Bad asset content never fails it: the
// assets come from another repo at deploy time, so a broken file or entry is
// left out and described in Warnings instead.
func Load() Catalogs {
	return loadFrom(assetsFS)
}

func loadFrom(fsys fs.FS) Catalogs {
	cs := make(Catalogs, len(models.SheetKinds()))
	for _, info := range models.SheetKinds() {
		cs[info.Kind] = loadCatalog(fsys, assetsDir(info.Kind))
	}
	return cs
}

// assetsDir is where the files of a kind lie. Black Crusade keeps the root:
// its assets predate the other kinds.
func assetsDir(kind models.SheetKind) string {
	if kind == models.KindBlackCrusade {
		return "assets"
	}
	return path.Join("assets", string(kind))
}

// Warnings returns the warnings of every catalog in the kinds' UI order.
func (cs Catalogs) Warnings() []string {
	var ws []string
	for _, info := range models.SheetKinds() {
		if c := cs[info.Kind]; c != nil {
			ws = append(ws, c.Warnings...)
		}
	}
	return ws
}

func loadCatalog(fsys fs.FS, dir string) *Catalog {
	c := &Catalog{
		Collections: make(map[string]*CollectionIndex, len(collectionFiles)),
	}

	c.loadInto(fsys, dir, "advancements.json", into(&c.Advancements))
	c.loadInto(fsys, dir, "conditions.json", into(&c.Conditions))
	c.loadInto(fsys, dir, "gear.json", into(&c.Gear))
	c.loadInto(fsys, dir, "armour_mods.json", into(&c.ArmourMods))
	c.loadInto(fsys, dir, "cybernetics.json", into(&c.Cybernetics))
	c.loadInto(fsys, dir, "melee.json", into(&c.Melee))
	c.loadInto(fsys, dir, "psychic_powers.json", into(&c.PsychicPowers))
	c.loadInto(fsys, dir, "ranged.json", into(&c.Ranged))
	c.loadInto(fsys, dir, "weapon_mods.json", into(&c.WeaponMods))
	c.loadInto(fsys, dir, "tech_powers.json", into(&c.TechPowers))

	// Sorted so the warnings come in the same order on every start.
	for _, name := range slices.Sorted(maps.Keys(collectionFiles)) {
		// Known even without its file: the search of a collection that is not
		// exported for a kind yet is empty, not an unknown collection.
		c.Collections[name] = nil
		c.loadInto(fsys, dir, collectionFiles[name], func(raws []json.RawMessage) []error {
			idx, skipped := NewIndex[CollectionEntry](raws)
			c.Collections[name] = idx
			return skipped
		})
	}

	c.Warnings = append(c.Warnings, conditionWarnings(assetName(dir, "conditions.json"), c.Conditions)...)
	c.Warnings = append(c.Warnings, conditionWarnings(assetName(dir, "gear.json"), c.Gear)...)
	c.Warnings = append(c.Warnings, conditionWarnings(assetName(dir, "armour_mods.json"), c.ArmourMods)...)
	c.Warnings = append(c.Warnings, conditionWarnings(assetName(dir, "cybernetics.json"), c.Cybernetics)...)

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

// assetName names a file in warnings: relative to assets, so a file of a
// kind's subfolder says which kind it is.
func assetName(dir, name string) string {
	return strings.TrimPrefix(path.Join(dir, name), "assets/")
}

// loadInto decodes the JSON array in dir/name and passes its elements to build.
// A missing file is skipped silently. A file that can't be read or isn't an
// array is skipped with a warning and build is not called, so its collection
// stays as if the file were missing.
func (c *Catalog) loadInto(fsys fs.FS, dir, name string, build func([]json.RawMessage) []error) {
	file := assetName(dir, name)
	f, err := fsys.Open(path.Join(dir, name))
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
