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
			name:    "Black Crusade gets none",
			content: `{"psykana": {"basePR": 2, "tabs": {"items": {"t1": {"powers": {"items": {"s1": {"name": "Bolt"}}}}}}}}`,
			wantNot: []string{`"mana"`, `"prepared"`},
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
