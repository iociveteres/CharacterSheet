package gamedata

import (
	"encoding/json"
	"fmt"
	"strings"

	"charactersheet.iociveteres.net/internal/models"
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

// ClientJSON gives the enchantment as a gear item keeps it
// (models.GearEnchantment): its levels as a grid, each with its "conditions"
// turned into an "entries" grid and led by the text the wiki puts before the
// levels (requirement, description), and the first level chosen.
func (e *Enchantment) ClientJSON() json.RawMessage {
	raw := e.CollectionEntry.ClientJSON()
	var top struct {
		Requirement string `json:"requirement"`
		Description string `json:"description"`
	}
	if err := json.Unmarshal(raw, &top); err != nil {
		return raw
	}
	var intro []string
	if top.Requirement != "" {
		intro = append(intro, "Требование: "+top.Requirement+".")
	}
	if top.Description != "" {
		intro = append(intro, top.Description)
	}

	out := models.GearEnchantment{
		Name: e.Name,
		Levels: models.ItemGrid[models.GearEnchantmentLevel]{
			Items:   make(map[string]models.GearEnchantmentLevel, len(e.Levels)),
			Layouts: make(map[string]models.Position, len(e.Levels)),
		},
		Description:      strings.Join(intro, "\n"),
		ConditionEntries: assetConditions{}.grid(),
	}
	for i, rawLevel := range e.Levels {
		var l struct {
			Capacity     float64  `json:"capacity"`
			Text         string   `json:"text"`
			Special      string   `json:"special"`
			WeightFactor *float64 `json:"weightFactor"`
		}
		// Never the asset as it is: the sheet would not decode its levels.
		if err := json.Unmarshal(rawLevel, &l); err != nil {
			continue
		}
		level := models.GearEnchantmentLevel{
			Capacity:         l.Capacity,
			Text:             strings.Join(append(intro[:len(intro):len(intro)], l.Text), "\n"),
			Special:          l.Special,
			WeightFactor:     l.WeightFactor,
			ConditionEntries: e.levels[i].grid(),
		}
		id := "lvl-" + newNanoid()
		out.Levels.Items[id] = level
		out.Levels.Layouts[id] = models.Position{ColIndex: 0, RowIndex: i}
		if i == 0 {
			out.Level = id
			out.Capacity = level.Capacity
			out.WeightFactor = level.WeightFactor
			out.Description = level.Text
			out.Special = level.Special
			out.ConditionEntries = level.ConditionEntries
		}
	}
	b, err := json.Marshal(out)
	if err != nil {
		return raw
	}
	return b
}

type EnchantmentIndex = Index[Enchantment, *Enchantment]
