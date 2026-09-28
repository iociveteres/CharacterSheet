package gamedata

import "encoding/json"

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
// "entries" grid; a picked item starts carried.
func (g *Gear) ClientJSON() json.RawMessage {
	return withEntries(g.CollectionEntry.ClientJSON(), g.conditions, map[string]json.RawMessage{
		"carried": json.RawMessage("true"),
	})
}

type GearIndex = Index[Gear, *Gear]
