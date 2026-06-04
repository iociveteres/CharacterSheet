package gamedata

import (
	"encoding/json"

	"charactersheet.iociveteres.net/internal/models"
)

type Cybernetics struct {
	CollectionEntry
	EntryType string `json:"entryType"`
}

type cyberneticConditionRaw struct {
	Type  string `json:"type"`
	Name  string `json:"name"`
	Value string `json:"value"`
}

// ClientJSON transforms asset conditions array → entries ItemGrid.
// If no conditions are present, entries is left as an empty grid.
func (c *Cybernetics) ClientJSON() json.RawMessage {
	raw := c.CollectionEntry.ClientJSON()

	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw
	}

	type entriesShape struct {
		Items   map[string]models.ConditionEntry `json:"items"`
		Layouts map[string]models.Position       `json:"layouts"`
	}

	items := make(map[string]models.ConditionEntry)
	layouts := make(map[string]models.Position)

	if condRaw, ok := m["conditions"]; ok {
		var conds []cyberneticConditionRaw
		if err := json.Unmarshal(condRaw, &conds); err == nil {
			for i, cond := range conds {
				id := "cond-" + newNanoid()
				val := cond.Value

				var entry models.ConditionEntry
				entry.Name = cond.Name
				switch cond.Type {
				case "CharacteristicBonus":
					entry.Type = "char_bonus"
					entry.Bonus = val
				case "CharacteristicCap":
					entry.Type = "char_cap"
					entry.Cap = val
				case "RollBonus":
					entry.Type = "roll_bonus"
					entry.RollBonus = val
				case "SkillBonus":
					entry.Type = "skill_bonus"
					entry.SkillBonus = val
				case "ablativeWounds":
					entry.Type = "ablative"
					entry.AblativeWounds = val
				default:
					entry.Type = "char_bonus"
					entry.Bonus = val
				}

				items[id] = entry
				layouts[id] = models.Position{ColIndex: 0, RowIndex: i}
			}
		}
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

type CyberneticsIndex = Index[Cybernetics, *Cybernetics]
