package gamedata

import (
	"encoding/json"
	"reflect"
	"testing"
	"testing/fstest"

	"charactersheet.iociveteres.net/internal/models"
)

const conditionsAsset = `[
	{"name": "Frenzy (Wounded Beast)", "name_ru": "Ярость (Раненный Зверь)",
	 "x": "1 — не ранен, 2 — легко ранен",
	 "conditions": [
		{"type": "CharacteristicBonus", "name": "WS", "value": "5X+5"},
		{"type": "RollBonus", "name": "BS", "value": "-20"}]},
	{"name": "Stunned", "name_ru": "Оглушение", "x": null,
	 "conditions": [{"type": "Teleport", "value": "1"}, {"type": "SkillBonus", "name": "Dodge", "value": "-X"}]},
	{"name": "Prone", "conditions": []}
]`

func loadConditions(t *testing.T) *Catalog {
	t.Helper()
	c := loadFrom(fstest.MapFS{"assets/conditions.json": {Data: []byte(conditionsAsset)}})
	if c.Conditions == nil {
		t.Fatal("no conditions index")
	}
	return c
}

func names(cs []Condition) []string {
	var out []string
	for _, c := range cs {
		out = append(out, c.Name)
	}
	return out
}

func TestConditionsSearch(t *testing.T) {
	idx := loadConditions(t).Conditions
	tests := []struct {
		query string
		want  []string
	}{
		{"frenzy", []string{"Frenzy (Wounded Beast)"}},
		{"BEAST", []string{"Frenzy (Wounded Beast)"}},
		{"ярость", []string{"Frenzy (Wounded Beast)"}},
		{"оглуш", []string{"Stunned"}},
		// A prefix match comes before a substring match.
		{"s", []string{"Stunned", "Frenzy (Wounded Beast)"}},
		{"nothing", nil},
	}
	for _, tt := range tests {
		if got := names(idx.Search(tt.query, 10)); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("Search(%q) = %q, want %q", tt.query, got, tt.want)
		}
	}
}

func TestConditionsSearchResultJSON(t *testing.T) {
	b, err := json.Marshal(loadConditions(t).Conditions.Search("ярость", 10))
	if err != nil {
		t.Fatal(err)
	}
	want := `[{"name":"Frenzy (Wounded Beast)","name_ru":"Ярость (Раненный Зверь)"}]`
	if string(b) != want {
		t.Errorf("got %s, want %s", b, want)
	}
}

func TestConditionClientJSON(t *testing.T) {
	idx := loadConditions(t).Conditions
	raw := idx.GetByName("frenzy (wounded beast)").ClientJSON()

	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	if len(keys) != 2 || string(m["name"]) != `"Frenzy (Wounded Beast)"` || m["entries"] == nil {
		t.Fatalf("got %s, want only name and entries", raw)
	}

	// What the sheet stores the picked condition as.
	var cond models.Condition
	if err := json.Unmarshal(raw, &cond); err != nil {
		t.Fatal(err)
	}
	rows := make(map[int]models.ConditionEntry)
	for id, e := range cond.Entries.Items {
		pos, ok := cond.Entries.Layouts[id]
		if !ok {
			t.Fatalf("no layout for %s", id)
		}
		rows[pos.RowIndex] = e
	}
	want := map[int]models.ConditionEntry{
		0: {Type: "char_bonus", Name: "WS", Bonus: "5X+5"},
		1: {Type: "roll_bonus", Name: "BS", RollBonus: "-20"},
	}
	if !reflect.DeepEqual(rows, want) || len(cond.Entries.Layouts) != 2 {
		t.Errorf("entries %s, want rows %+v", m["entries"], want)
	}

	_, g := entriesOf(t, idx.GetByName("Prone").ClientJSON())
	if g.Items == nil || g.Layouts == nil || len(g.Items) != 0 {
		t.Errorf("want an empty grid, got %+v", g)
	}
}

func TestLoadWarnsOfSkippedEntries(t *testing.T) {
	c := loadFrom(fstest.MapFS{
		"assets/conditions.json": {Data: []byte(conditionsAsset)},
		"assets/gear.json":       {Data: []byte(`[{"name":"Rope","conditions":{}},{"name":"Jump Pack","conditions":[{"type":"Flight","value":"12"}]}]`)},
	})
	want := []string{
		`conditions.json: Stunned: skipped condition entry 0: unknown type "Teleport"`,
		`gear.json: Jump Pack: skipped condition entry 0: unknown type "Flight"`,
	}
	if !reflect.DeepEqual(c.Warnings, want) {
		t.Errorf("warnings %q, want %q", c.Warnings, want)
	}
	// The rest of the entry stays.
	if got := len(c.Conditions.GetByName("Stunned").conditions.entries); got != 1 {
		t.Errorf("Stunned has %d entries, want 1", got)
	}
}

func TestLoadWithoutConditionsFile(t *testing.T) {
	c := loadFrom(fstest.MapFS{"assets/placeholder.json": {Data: []byte(`[]`)}})
	if c.Conditions != nil {
		t.Fatal("want no conditions index")
	}
	if got := c.Conditions.Search("frenzy", 10); got != nil {
		t.Errorf("Search on a missing index = %v", got)
	}
	if got := c.Conditions.GetByName("Frenzy"); got != nil {
		t.Errorf("GetByName on a missing index = %v", got)
	}
	if len(c.Warnings) != 0 {
		t.Errorf("warnings %q", c.Warnings)
	}
}
