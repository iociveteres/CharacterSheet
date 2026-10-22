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
}

type WeaponModIndex = Index[WeaponModEntry, *WeaponModEntry]
