package gamedata

import (
	"encoding/json"

	"charactersheet.iociveteres.net/internal/models"
)

type Gear struct {
	CollectionEntry
	EntryType string `json:"entryType"`
}

type gearConditionRaw struct {
	Type           string `json:"type"`
	Name           string `json:"name"`
	Value          string `json:"value"`
	UnnaturalValue string `json:"unnatural,omitempty"`
}

// ClientJSON transforms the asset shape into the DB/client shape,
// mapping the asset's `conditions` array to an `entries` ItemGrid.
// All other fields pass through unchanged via the raw map.
func (g *Gear) ClientJSON() json.RawMessage {
	raw := g.CollectionEntry.ClientJSON()

	// Work on a raw map so all existing fields (name, armour, weight, etc.) pass through.
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw
	}
	m["carried"] = json.RawMessage("true")
	
	// Extract and transform conditions array
	type entriesShape struct {
		Items   map[string]models.ConditionEntry `json:"items"`
		Layouts map[string]models.Position       `json:"layouts"`
	}

	items := make(map[string]models.ConditionEntry)
	layouts := make(map[string]models.Position)

	if condRaw, ok := m["conditions"]; ok {
		var conds []gearConditionRaw
		if err := json.Unmarshal(condRaw, &conds); err == nil {
			for i, c := range conds {
				id := "cond-" + newNanoid()
				val := c.Value
				unnaturalVal := c.UnnaturalValue

				var entry models.ConditionEntry
				entry.Name = c.Name
				switch c.Type {
				case "CharacteristicBonus":
					entry.Type = "char_bonus"
					entry.Bonus = val
					entry.UnnaturalBonus = unnaturalVal
				case "CharacteristicCap":
					entry.Type = "char_cap"
					entry.Cap = val
				case "RollBonus":
					entry.Type = "roll_bonus"
					entry.RollBonus = val
				case "SkillBonus":
					entry.Type = "skill_bonus"
					entry.SkillBonus = val
				case "AblativeWounds":
					entry.Type = "ablative_wounds"
					entry.AblativeWounds = val
				default:
					entry.Type = "char_bonus"
					entry.Bonus = val
				}

				items[id] = entry
				layouts[id] = models.Position{ColIndex: 0, RowIndex: i}
			}
		}
		// Remove the raw conditions field — it's replaced by entries
		delete(m, "conditions")
	}

	entriesJSON, err := json.Marshal(entriesShape{Items: items, Layouts: layouts})
	if err != nil {
		return raw
	}
	m["entries"] = entriesJSON

	out, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return out
}

type GearIndex = Index[Gear, *Gear]
