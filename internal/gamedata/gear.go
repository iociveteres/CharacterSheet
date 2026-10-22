package gamedata

import (
	"bytes"
	"encoding/json"

	"charactersheet.iociveteres.net/internal/models"
)

type Gear struct {
	CollectionEntry
	EntryType string `json:"entryType"`

	conditions assetConditions
}

func (g *Gear) initRaw(raw json.RawMessage) {
	g.CollectionEntry.initRaw(raw)
	g.conditions = conditionsFromRaw(raw)
}

func (g *Gear) skippedConditions() []string { return g.conditions.skipped }

// ClientJSON passes the asset fields through with "conditions" turned into an
// "entries" grid and the "upgrades" text of the armour into its "mods" grid;
// a picked item starts carried.
func (g *Gear) ClientJSON() json.RawMessage {
	set := map[string]json.RawMessage{"carried": json.RawMessage("true")}
	if armour := armourWithMods(g.CollectionEntry.ClientJSON()); armour != nil {
		set["armour"] = armour
	}
	return withEntries(g.CollectionEntry.ClientJSON(), g.conditions, set)
}

// armourWithMods is the armour of the asset entry raw with its upgrades text
// as models.ArmourMods makes a grid of it, or nil for an entry without one.
func armourWithMods(raw json.RawMessage) json.RawMessage {
	var entry struct {
		Armour map[string]any `json:"armour"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&entry); err != nil || entry.Armour == nil {
		return nil
	}
	upgrades, ok := entry.Armour["upgrades"]
	if !ok {
		return nil
	}
	delete(entry.Armour, "upgrades")
	if entry.Armour["mods"] == nil {
		text, _ := upgrades.(string)
		entry.Armour["mods"] = models.ArmourMods(text)
	}
	out, err := json.Marshal(entry.Armour)
	if err != nil {
		return nil
	}
	return out
}

type GearIndex = Index[Gear, *Gear]

// ArmourMod is a modification of armour from the book, which a mod of a gear
// item's armour (models.GearMod) is picked from.
type ArmourMod struct {
	CollectionEntry
	// The section of the book's list: General, Helmet, Torso, …
	EntryType string `json:"entryType"`

	conditions assetConditions
}

func (m *ArmourMod) initRaw(raw json.RawMessage) {
	m.CollectionEntry.initRaw(raw)
	m.conditions = conditionsFromRaw(raw)
}

func (m *ArmourMod) skippedConditions() []string { return m.conditions.skipped }

// ClientJSON passes the asset fields through with "conditions" turned into an
// "entries" grid.
func (m *ArmourMod) ClientJSON() json.RawMessage {
	return withEntries(m.CollectionEntry.ClientJSON(), m.conditions, nil)
}

type ArmourModIndex = Index[ArmourMod, *ArmourMod]
