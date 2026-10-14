package roomws

import (
	"encoding/json"
	"testing"

	"charactersheet.iociveteres.net/internal/gamedata"
	"charactersheet.iociveteres.net/internal/models"
)

func TestOverlayObject(t *testing.T) {
	tests := []struct {
		name, base, top, want string
		wantErr               bool
	}{
		{
			name: "entry fields win, the rest comes from the base",
			base: `{"stacks":1,"enabled":true,"name":"old"}`,
			top:  `{"name":"Stunned","entries":{"items":{"e1":{"type":"char_bonus"}}}}`,
			want: `{"enabled":true,"entries":{"items":{"e1":{"type":"char_bonus"}}},"name":"Stunned","stacks":1}`,
		},
		{name: "null base", base: `null`, top: `{"name":"A"}`, want: `{"name":"A"}`},
		{name: "base is not an object", base: `[1]`, top: `{}`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := overlayObject(json.RawMessage(tt.base), json.RawMessage(tt.top))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("want an error, got %s", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tt.want {
				t.Errorf("got %s, want %s", got, tt.want)
			}
		})
	}
}

func TestConditionsCollection(t *testing.T) {
	idx, skipped := gamedata.NewIndex[gamedata.Condition]([]json.RawMessage{
		json.RawMessage(`{"name":"Blinded","name_ru":"Ослепление","conditions":[{"type":"RollBonus","name":"BS","value":"-30"}]}`),
	})
	if skipped != nil {
		t.Fatal(skipped)
	}
	app := NewServer(&Dependencies{Gamedata: &gamedata.Catalog{Conditions: idx}})

	got, err := app.searchCollection("conditions", "ослеп")
	if err != nil {
		t.Fatal(err)
	}
	if want := `[{"name":"Blinded","name_ru":"Ослепление"}]`; string(got) != want {
		t.Errorf("search got %s, want %s", got, want)
	}

	changes, ok := app.getClientJSON("conditions", "Blinded")
	if !ok {
		t.Fatal("Blinded not found")
	}
	var cond struct {
		Name    string `json:"name"`
		Entries struct {
			Items map[string]struct {
				Type      string `json:"type"`
				RollBonus string `json:"rollBonus"`
			} `json:"items"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(changes, &cond); err != nil {
		t.Fatal(err)
	}
	if cond.Name != "Blinded" || len(cond.Entries.Items) != 1 {
		t.Errorf("apply got %s", changes)
	}
	for _, e := range cond.Entries.Items {
		if e.Type != "roll_bonus" || e.RollBonus != "-30" {
			t.Errorf("entry %+v", e)
		}
	}
}

// gamedata.Load leaves a collection whose asset file is missing, or was
// skipped as malformed, as a nil index or, for the generic collections, out of
// Collections.
func TestCollectionsWithoutAsset(t *testing.T) {
	app := NewServer(&Dependencies{Gamedata: &gamedata.Catalog{Collections: map[string]*gamedata.CollectionIndex{}}})
	for _, c := range []string{"advancements", "conditions", "gear", "cybernetics", "melee", "psychicPowers", "ranged", "techPowers"} {
		got, err := app.searchCollection(c, "a")
		if err != nil || string(got) != "[]" {
			t.Errorf("%s: search got %s, %v", c, got, err)
		}
		if _, ok := app.getClientJSON(c, "a"); ok {
			t.Errorf("%s: apply found an entry", c)
		}
	}
	// The client gets a validation error, as for an unknown collection.
	if got, err := app.searchCollection("talents", "a"); err == nil {
		t.Errorf("talents: search got %s", got)
	}
	if _, ok := app.getClientJSON("talents", "a"); ok {
		t.Error("talents: apply found an entry")
	}
}

// A Sorcery spell of the autocomplete, «Delude (Bard)», is a spell entry with
// the Sorcery type in its Subtypes, a level and a roll on a skill
// (_prd/sheet_kinds/half_casters.md). The apply lays it over the new item the
// sheet sends: its roll replaces the item's whole, the fields it lacks come
// from the item, and the content keeps them all.
func TestSorcerySpellApply(t *testing.T) {
	idx, skipped := gamedata.NewIndex[gamedata.PsychicPower]([]json.RawMessage{
		json.RawMessage(`{"name":"Delude (Bard)","subtypes":"Иллюзия, Sorcery (Bard)","level":1,"psychotest":"Charm(F) -10 vs W +0","sustained":"Свободное действие","roll":{"skill":"charm","characteristic":"","modifier":-10}}`),
	})
	if skipped != nil {
		t.Fatal(skipped)
	}
	app := NewServer(&Dependencies{Gamedata: &gamedata.Catalog{PsychicPowers: idx}})

	entry, ok := app.getClientJSON("psychicPowers", "Delude (Bard)")
	if !ok {
		t.Fatal("Delude (Bard) not found")
	}
	base := `{"name":"","subtypes":"","level":0,"prepared":false,"sustain":{"copies":0,"pr":0,"free":false},` +
		`"roll":{"testOption":"o1","modifier":0,"effectivePR":0,"kickPR":0,"safe":false,"extra1":{"name":"","value":0,"enabled":false}}}`
	merged, err := overlayObject(json.RawMessage(base), entry)
	if err != nil {
		t.Fatal(err)
	}

	var power models.PsychicPower
	if err := json.Unmarshal(merged, &power); err != nil {
		t.Fatal(err)
	}
	if power.Name != "Delude (Bard)" || power.Subtypes != "Иллюзия, Sorcery (Bard)" || power.Level != 1 {
		t.Errorf("spell %+v", power)
	}
	if power.Roll == nil {
		t.Fatalf("no roll in %s", merged)
	}
	if want := (models.PsychicPowerRoll{Skill: "charm", Modifier: -10}); *power.Roll != want {
		t.Errorf("roll %+v, want the entry's alone %+v", *power.Roll, want)
	}

	out, err := json.Marshal(power)
	if err != nil {
		t.Fatal(err)
	}
	var back map[string]json.RawMessage
	if err := json.Unmarshal(out, &back); err != nil {
		t.Fatal(err)
	}
	if string(back["level"]) != "1" || string(back["sustain"]) != `{"copies":0,"pr":0,"free":false}` {
		t.Errorf("content %s", out)
	}
}
