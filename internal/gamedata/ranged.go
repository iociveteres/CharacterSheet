package gamedata

import (
	"encoding/json"

	"charactersheet.iociveteres.net/internal/models"
)

type Ranged struct {
	CollectionEntry
	EntryType string `json:"entryType"`
}

// ClientJSON passes the asset fields through with the "upgrades" text, the
// mods the weapon comes with, at the end of the description, as
// models.DescriptionWithUpgrades puts it: an attack has no upgrades field.
func (r *Ranged) ClientJSON() json.RawMessage {
	raw := r.CollectionEntry.ClientJSON()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw
	}
	upgrades, ok := m["upgrades"]
	if !ok {
		return raw
	}
	delete(m, "upgrades")
	var text, description string
	_ = json.Unmarshal(upgrades, &text)
	_ = json.Unmarshal(m["description"], &description)
	if with := models.DescriptionWithUpgrades(description, text); with != description {
		b, err := json.Marshal(with)
		if err != nil {
			return raw
		}
		m["description"] = b
	}
	out, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return out
}

type RangedIndex = Index[Ranged, *Ranged]

// WeaponModEntry is a modification of a ranged or melee weapon from the book,
// which a mod of a gear item's weapon (models.GearWeaponMod) is picked from.
type WeaponModEntry struct {
	CollectionEntry
	// The section of the book's list: Sights, Melee attachments, Materials, …
	EntryType string `json:"entryType"`

	conditions      assetConditions
	hasWeightFactor bool
}

func (m *WeaponModEntry) initRaw(raw json.RawMessage) {
	m.CollectionEntry.initRaw(raw)
	m.conditions = conditionsFromRaw(raw)
	var f struct {
		WeightFactor *float64 `json:"weightFactor"`
	}
	_ = json.Unmarshal(raw, &f)
	m.hasWeightFactor = f.WeightFactor != nil
}

func (m *WeaponModEntry) skippedConditions() []string { return m.conditions.skipped }

// ClientJSON passes the asset fields through with "conditions" turned into an
// "entries" grid, and a weightFactor of 1 when the asset has none: the pick
// merges into the mod, which would keep the factor of the mod it replaces.
func (m *WeaponModEntry) ClientJSON() json.RawMessage {
	var set map[string]json.RawMessage
	if !m.hasWeightFactor {
		set = map[string]json.RawMessage{"weightFactor": json.RawMessage("1")}
	}
	return withEntries(m.CollectionEntry.ClientJSON(), m.conditions, set)
}

type WeaponModIndex = Index[WeaponModEntry, *WeaponModEntry]
