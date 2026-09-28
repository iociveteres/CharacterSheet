package gamedata

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

func TestToConditionEntry(t *testing.T) {
	tests := []struct {
		asset string
		want  models.ConditionEntry
	}{
		{
			`{"type":"CharacteristicBonus","name":"WS","value":"5X+5","unnatural":"1"}`,
			models.ConditionEntry{Type: "char_bonus", Name: "WS", Bonus: "5X+5", UnnaturalBonus: "1"},
		},
		{
			`{"type":"CharacteristicCap","name":"Ag","value":"30"}`,
			models.ConditionEntry{Type: "char_cap", Name: "Ag", Cap: "30"},
		},
		{
			`{"type":"CharacteristicOverride","name":"S","value":"60","unnatural":"4"}`,
			models.ConditionEntry{Type: "char_override", Name: "S", OverrideValue: "60", OverrideUnnatural: "4"},
		},
		{
			`{"type":"RollBonus","name":"BS","value":"-20"}`,
			models.ConditionEntry{Type: "roll_bonus", Name: "BS", RollBonus: "-20"},
		},
		{
			`{"type":"SkillBonus","name":"Dodge","value":"-X"}`,
			models.ConditionEntry{Type: "skill_bonus", Name: "Dodge", SkillBonus: "-X"},
		},
		{
			`{"type":"AblativeWounds","value":"0.5X▲"}`,
			models.ConditionEntry{Type: "ablative_wounds", AblativeWounds: "0.5X▲"},
		},
		{
			`{"type":"InitiativeBonus","value":"2"}`,
			models.ConditionEntry{Type: "initiative_bonus", InitiativeBonus: "2"},
		},
		{
			`{"type":"MovementBonus","value":"-1"}`,
			models.ConditionEntry{Type: "movement_bonus", MovementBonus: "-1"},
		},
		{
			`{"type":"BonusAP","apType":"Machine","value":"2"}`,
			models.ConditionEntry{Type: "bonus_ap", APType: "machine", APValue: "2"},
		},
		// Types without a name drop one the asset has: the sheet hides that field.
		{
			`{"type":"AblativeWounds","name":"W","value":"3"}`,
			models.ConditionEntry{Type: "ablative_wounds", AblativeWounds: "3"},
		},
		// Missing fields stay empty for the player to fill in.
		{
			`{"type":"CharacteristicBonus"}`,
			models.ConditionEntry{Type: "char_bonus"},
		},
		{
			`{"type":"BonusAP","value":"1"}`,
			models.ConditionEntry{Type: "bonus_ap", APValue: "1"},
		},
		{
			`{"type":"RollBonus","name":null,"value":-10}`,
			models.ConditionEntry{Type: "roll_bonus", RollBonus: "-10"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.asset, func(t *testing.T) {
			var a assetConditionEntry
			if err := json.Unmarshal([]byte(tt.asset), &a); err != nil {
				t.Fatal(err)
			}
			got, ok := toConditionEntry(a)
			if !ok {
				t.Fatal("not converted")
			}
			if got != tt.want {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestToConditionEntryUnknownType(t *testing.T) {
	for _, typ := range []string{"", "Frenzy", "characteristicBonus", "ablativeWounds", "char_bonus"} {
		if e, ok := toConditionEntry(assetConditionEntry{Type: typ, Name: "WS", Value: "10"}); ok {
			t.Errorf("type %q converted to %+v", typ, e)
		}
	}
}

func TestConditionsFromRaw(t *testing.T) {
	tests := []struct {
		name        string
		raw         string
		wantTypes   []string
		wantSkipped []string
	}{
		{name: "no field", raw: `{"name":"A"}`},
		{name: "null", raw: `{"conditions":null}`},
		{name: "empty object, as older assets write it", raw: `{"conditions":{}}`},
		{name: "empty array", raw: `{"conditions":[]}`},
		{
			name:      "keeps the order",
			raw:       `{"conditions":[{"type":"RollBonus","name":"BS","value":"-20"},{"type":"CharacteristicBonus","name":"WS","value":"5"}]}`,
			wantTypes: []string{"roll_bonus", "char_bonus"},
		},
		{
			name:        "skips an unknown type",
			raw:         `{"conditions":[{"type":"Teleport","value":"1"},{"type":"MovementBonus","value":"1"}]}`,
			wantTypes:   []string{"movement_bonus"},
			wantSkipped: []string{`entry 0: unknown type "Teleport"`},
		},
		{
			name:        "skips an entry that is not an object",
			raw:         `{"conditions":["WS +10",{"type":"MovementBonus","value":"1"}]}`,
			wantTypes:   []string{"movement_bonus"},
			wantSkipped: []string{"entry 0: "},
		},
		{
			name:        "skips a value that is not a string",
			raw:         `{"conditions":[{"type":"MovementBonus","value":[1]}]}`,
			wantSkipped: []string{"entry 0: "},
		},
		{
			name:        "skips conditions that are not an array",
			raw:         `{"conditions":"WS +10"}`,
			wantSkipped: []string{"conditions is not an array"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := conditionsFromRaw(json.RawMessage(tt.raw))
			var types []string
			for _, e := range c.entries {
				types = append(types, e.Type)
			}
			if !reflect.DeepEqual(types, tt.wantTypes) {
				t.Errorf("types %v, want %v", types, tt.wantTypes)
			}
			if len(c.skipped) != len(tt.wantSkipped) {
				t.Fatalf("skipped %q, want %q", c.skipped, tt.wantSkipped)
			}
			for i, s := range c.skipped {
				if !strings.HasPrefix(s, tt.wantSkipped[i]) {
					t.Errorf("skipped[%d] = %q, want prefix %q", i, s, tt.wantSkipped[i])
				}
			}
		})
	}
}

func TestAssetConditionsGrid(t *testing.T) {
	c := conditionsFromRaw(json.RawMessage(`{"conditions":[
		{"type":"RollBonus","name":"BS","value":"-20"},
		{"type":"CharacteristicBonus","name":"WS","value":"5"},
		{"type":"AblativeWounds","value":"2"}]}`))

	g := c.grid()
	if len(g.Items) != 3 || len(g.Layouts) != 3 {
		t.Fatalf("got %d items and %d layouts, want 3", len(g.Items), len(g.Layouts))
	}
	byRow := make(map[int]string)
	for id, pos := range g.Layouts {
		if pos.ColIndex != 0 {
			t.Errorf("%s in column %d", id, pos.ColIndex)
		}
		byRow[pos.RowIndex] = g.Items[id].Type
	}
	want := map[int]string{0: "roll_bonus", 1: "char_bonus", 2: "ablative_wounds"}
	if !reflect.DeepEqual(byRow, want) {
		t.Errorf("rows %v, want %v", byRow, want)
	}

	for id := range c.grid().Items {
		if _, ok := g.Items[id]; ok {
			t.Errorf("id %s repeats between calls", id)
		}
	}
}

// entriesOf decodes the "entries" grid of a ClientJSON result.
func entriesOf(t *testing.T, raw json.RawMessage) (map[string]json.RawMessage, models.ItemGrid[models.ConditionEntry]) {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	var g models.ItemGrid[models.ConditionEntry]
	if err := json.Unmarshal(m["entries"], &g); err != nil {
		t.Fatalf("entries %s: %v", m["entries"], err)
	}
	return m, g
}

func TestGearAndCyberneticsClientJSON(t *testing.T) {
	gear, err := NewIndex[Gear]([]json.RawMessage{
		json.RawMessage(`{"name":"Flak Armour","entryType":"armour","weight":5,"conditions":[{"type":"CharacteristicCap","name":"Ag","value":"40"},{"type":"InitiativeBonus","value":"-1"}]}`),
		json.RawMessage(`{"name":"Rope","weight":1,"conditions":{}}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	m, g := entriesOf(t, gear.GetByName("flak armour").ClientJSON())
	if _, ok := m["conditions"]; ok {
		t.Error("conditions is still there")
	}
	if string(m["carried"]) != "true" || string(m["weight"]) != "5" || string(m["entryType"]) != `"armour"` {
		t.Errorf("fields did not pass through: %v", m)
	}
	if len(g.Items) != 2 {
		t.Errorf("got %d entries, want 2", len(g.Items))
	}
	for _, e := range g.Items {
		if e.Type != "char_cap" && e.Type != "initiative_bonus" {
			t.Errorf("entry %+v", e)
		}
	}

	_, g = entriesOf(t, gear.GetByName("Rope").ClientJSON())
	if g.Items == nil || g.Layouts == nil || len(g.Items) != 0 {
		t.Errorf("want an empty grid, got %+v", g)
	}

	cyber, err := NewIndex[Cybernetics]([]json.RawMessage{
		json.RawMessage(`{"name":"Subskin Armour","conditions":[{"type":"BonusAP","apType":"machine","value":"2"}]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	m, g = entriesOf(t, cyber.GetByName("Subskin Armour").ClientJSON())
	if _, ok := m["carried"]; ok {
		t.Error("an implant got carried")
	}
	for _, e := range g.Items {
		if e != (models.ConditionEntry{Type: "bonus_ap", APType: "machine", APValue: "2"}) {
			t.Errorf("entry %+v", e)
		}
	}
}
