package gamedata

import "encoding/json"

type Cybernetics struct {
	CollectionEntry
	EntryType string `json:"entryType"`

	conditions assetConditions
}

func (c *Cybernetics) initRaw(raw json.RawMessage) {
	c.CollectionEntry.initRaw(raw)
	c.conditions = conditionsFromRaw(raw)
}

func (c *Cybernetics) skippedConditions() []string { return c.conditions.skipped }

// ClientJSON passes the asset fields through with "conditions" turned into an
// "entries" grid.
func (c *Cybernetics) ClientJSON() json.RawMessage {
	return withEntries(c.CollectionEntry.ClientJSON(), c.conditions, nil)
}

type CyberneticsIndex = Index[Cybernetics, *Cybernetics]
