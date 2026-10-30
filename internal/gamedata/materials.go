package gamedata

import (
	"encoding/json"
	"fmt"
)

// Material is a material of Pathfinder Crusade items, which the material of
// a gear item is picked from (_prd/item_materials/plan.md).
type Material struct {
	CollectionEntry
	// The kind of material: Металл, Кожа, Ткань, …
	EntryType string `json:"entryType"`

	conditions assetConditions
}

func (m *Material) initRaw(raw json.RawMessage) {
	m.CollectionEntry.initRaw(raw)
	m.conditions = conditionsFromRaw(raw)
}

func (m *Material) skippedConditions() []string { return m.conditions.skipped }

// ClientJSON passes the asset fields through with "conditions" turned into an
// "entries" grid.
func (m *Material) ClientJSON() json.RawMessage {
	return withEntries(m.CollectionEntry.ClientJSON(), m.conditions, nil)
}

type MaterialIndex = Index[Material, *Material]

// InlayType is the entryType of the inlay gems, which materials.json lists
// after the materials.
const InlayType = "Инкрустация"

// splitInlays separates the inlay gems of materials.json from the materials.
// An entry that doesn't decode stays with the materials, whose index reports it.
func splitInlays(raws []json.RawMessage) (materials, gems []json.RawMessage) {
	for _, raw := range raws {
		var e struct {
			EntryType string `json:"entryType"`
		}
		if json.Unmarshal(raw, &e) == nil && e.EntryType == InlayType {
			gems = append(gems, raw)
		} else {
			materials = append(materials, raw)
		}
	}
	return materials, gems
}

// Enchantment is an enchantment of Pathfinder Crusade items with its levels,
// each of its own capacity, text, special and condition entries.
type Enchantment struct {
	CollectionEntry
	// The category: Универсальное, Оружие, Броня, …
	EntryType string            `json:"entryType"`
	Levels    []json.RawMessage `json:"levels"`

	levels []assetConditions
}

func (e *Enchantment) initRaw(raw json.RawMessage) {
	e.CollectionEntry.initRaw(raw)
	e.levels = make([]assetConditions, len(e.Levels))
	for i, level := range e.Levels {
		e.levels[i] = conditionsFromRaw(level)
	}
}

func (e *Enchantment) skippedConditions() []string {
	var out []string
	for i, c := range e.levels {
		for _, s := range c.skipped {
			out = append(out, fmt.Sprintf("level %d: %s", i, s))
		}
	}
	return out
}

// ClientJSON passes the asset fields through with the "conditions" of every
// level turned into an "entries" grid.
func (e *Enchantment) ClientJSON() json.RawMessage {
	raw := e.CollectionEntry.ClientJSON()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw
	}
	levels := make([]json.RawMessage, len(e.Levels))
	for i, level := range e.Levels {
		levels[i] = withEntries(level, e.levels[i], nil)
	}
	out, err := json.Marshal(levels)
	if err != nil {
		return raw
	}
	m["levels"] = out
	if out, err = json.Marshal(m); err != nil {
		return raw
	}
	return out
}

type EnchantmentIndex = Index[Enchantment, *Enchantment]
