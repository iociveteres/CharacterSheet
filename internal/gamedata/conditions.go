package gamedata

import (
	"encoding/json"

	"charactersheet.iociveteres.net/internal/models"
)

// Condition is an entry of conditions.json. The asset's "x" (a hint on what
// the stacks mean) is not shown by the sheet yet, so it is not sent.
type Condition struct {
	CollectionEntry

	conditions assetConditions
}

func (c *Condition) initRaw(raw json.RawMessage) {
	c.CollectionEntry.initRaw(raw)
	c.conditions = conditionsFromRaw(raw)
}

func (c *Condition) skippedConditions() []string { return c.conditions.skipped }

// ClientJSON is the part of a sheet condition that a picked entry sets; the
// client's base supplies enabled and stacks.
func (c *Condition) ClientJSON() json.RawMessage {
	out, err := json.Marshal(struct {
		Name    string                                 `json:"name"`
		Entries models.ItemGrid[models.ConditionEntry] `json:"entries"`
	}{c.Name, c.conditions.grid()})
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return out
}

type ConditionIndex = Index[Condition, *Condition]
