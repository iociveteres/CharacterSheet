package models

import (
	"encoding/json"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

// The content reaches the sheet through the struct (SheetPayload): a field it
// lacks would be lost on the way.
func TestPathfinderFieldsThroughTheContent(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []string
		wantNot []string
	}{
		{
			name:    "Pathfinder Crusade keeps its mana and rule",
			content: `{"mana": {"current": 3, "max": {"base": "7"}}, "settings": {"psykana": {"mana": false}}}`,
			want:    []string{`"mana":{"current":3,"max":{"base":"7"`, `"psykana":{"mana":false`},
		},
		{
			name:    "Pathfinder Crusade keeps a prepared spell and its rule",
			content: `{"psykana": {"tabs": {"items": {"t1": {"powers": {"items": {"s1": {"name": "Bolt", "prepared": true}}}}}}}, "settings": {"psykana": {"prepared": false}}}`,
			want:    []string{`"phenomenaMod":0,"prepared":true}`, `"psykana":{"prepared":false`},
		},
		{
			name:    "Pathfinder Crusade keeps an Arts spell",
			content: `{"psykana": {"tabs": {"items": {"t1": {"powers": {"items": {"s1": {"name": "Delude", "level": 1, "roll": {"skill": "deceive", "characteristic": "W"}}}}}}}}}`,
			want:    []string{`"level":1}`, `"skill":"deceive","characteristic":"W"}`},
		},
		{
			name:    "Pathfinder Crusade keeps its Spellcasting, Focus pools and the variant of a spell",
			content: `{"spellcasting": {"arcane": true, "bard": true}, "focus": {"bard": {"current": 2, "max": {"base": "4"}}}, "psykana": {"tabs": {"items": {"t1": {"powers": {"items": {"s1": {"name": "Bolt", "roll": {"spellcasting": "arcane"}}}}}}}}}`,
			want: []string{
				`"spellcasting":{"arcane":true,"divine":false,"spontaneous":false,"bard":true,"paladin":false,"ranger":false}`,
				`"focus":{"bard":{"current":2,"max":{"base":"4"`, `"spellcasting":"arcane"}`,
			},
		},
		{
			name:    "Pathfinder Crusade keeps its coins and whether they weigh",
			content: `{"coins": {"gp": 12, "cp": 5, "countWeight": false}}`,
			want:    []string{`"coins":{"pp":0,"gp":12,"sp":0,"cp":5,"countWeight":false}`},
		},
		{
			name:    "Pathfinder Crusade keeps the material, inlay and Broken of a gear item",
			content: `{"gear": {"list": {"items": {"g1": {"name": "Chainmail", "broken": true, "inlay": "Ruby", "material": {"name": "Mithral", "name_ru": "Мифрил", "weightFactor": 0.5, "capacityFactor": 1, "durability": 2, "ap": 1, "pen": 1, "short": "+20 Max.A", "special": "Броня получает +20 Max.A."}}}}}}`,
			want: []string{
				`"material":{"name":"Mithral","weightFactor":0.5,"capacityFactor":1,"durability":2,"ap":1,"pen":1,"short":"+20 Max.A","special":"Броня получает +20 Max.A.","entries":`,
				`"inlay":"Ruby","broken":true`,
			},
			wantNot: []string{`"name_ru"`},
		},
		{
			name:    "Pathfinder Crusade keeps the enchantments of a gear item with their levels",
			content: `{"gear": {"list": {"items": {"g1": {"name": "Cloak", "enchantments": {"items": {"e1": {"name": "Feather", "entryType": "Универсальное", "level": "l3", "capacity": 11, "weightFactor": 0, "description": "0 kg.", "levels": {"items": {"l3": {"capacity": 11, "text": "0 kg.", "weightFactor": 0}}, "layouts": {"l3": {"colIndex": 0, "rowIndex": 0}}}}}, "layouts": {}}}}}}}`,
			want: []string{
				`"enchantments":{"items":{"e1":{"name":"Feather","levels":{"items":{"l3":{"capacity":11,"text":"0 kg.","weightFactor":0,"entries":`,
				`"level":"l3","capacity":11,"weightFactor":0,"description":"0 kg.","entries":`,
			},
			wantNot: []string{`"entryType"`},
		},
		{
			name:    "Black Crusade gets none",
			content: `{"psykana": {"basePR": 2, "tabs": {"items": {"t1": {"powers": {"items": {"s1": {"name": "Bolt", "roll": {"testOption": "o1"}}}}}}}}}`,
			wantNot: []string{`"mana"`, `"prepared"`, `"level"`, `"skill"`, `"characteristic"`, `"spellcasting"`, `"focus"`, `"coins"`, `"material"`, `"inlay"`, `"broken"`, `"enchantments"`},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var content CharacterSheetContent
			assert.NilError(t, json.Unmarshal([]byte(tt.content), &content))
			out, err := json.Marshal(content)
			assert.NilError(t, err)
			for _, s := range tt.want {
				assert.StringContains(t, string(out), s)
			}
			for _, s := range tt.wantNot {
				assert.Equal(t, strings.Contains(string(out), s), false)
			}
		})
	}
}
