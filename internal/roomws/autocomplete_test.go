package roomws

import (
	"encoding/json"
	"reflect"
	"testing"
	"testing/fstest"

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
	g := &gamedata.Catalog{Conditions: idx}

	got, err := searchCollection(g, "conditions", "ослеп")
	if err != nil {
		t.Fatal(err)
	}
	if want := `[{"name":"Blinded","name_ru":"Ослепление"}]`; string(got) != want {
		t.Errorf("search got %s, want %s", got, want)
	}

	changes, ok := getClientJSON(g, "conditions", "Blinded")
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
// skipped as malformed, as a nil index.
func TestCollectionsWithoutAsset(t *testing.T) {
	g := gamedata.LoadFS(fstest.MapFS{"assets/placeholder.json": {Data: []byte(`[]`)}})[models.KindBlackCrusade]
	for _, c := range []string{"advancements", "conditions", "gear", "cybernetics", "melee", "psychicPowers", "ranged", "techPowers", "materials", "inlays", "enchantments", "talents", "traits", "powerShields"} {
		got, err := searchCollection(g, c, "a")
		if err != nil || string(got) != "[]" {
			t.Errorf("%s: search got %s, %v", c, got, err)
		}
		if _, ok := getClientJSON(g, c, "a"); ok {
			t.Errorf("%s: apply found an entry", c)
		}
	}
	// The client gets a validation error.
	if got, err := searchCollection(g, "spells", "a"); err == nil {
		t.Errorf("spells: search got %s", got)
	}
}

// An Arts spell of the autocomplete, «Delude (Bard)», is a spell entry with
// the Arts type in its Subtypes, a level and a roll on a skill
// (_prd/sheet_kinds/half_casters.md). The apply lays it over the new item the
// sheet sends: its roll replaces the item's whole, the fields it lacks come
// from the item, and the content keeps them all.
func TestArtsSpellApply(t *testing.T) {
	idx, skipped := gamedata.NewIndex[gamedata.PsychicPower]([]json.RawMessage{
		json.RawMessage(`{"name":"Delude (Bard)","subtypes":"Иллюзия, Arts (Bard)","level":1,"psychotest":"Charm(F) -10 vs W +0","sustained":"Свободное действие","roll":{"skill":"charm","characteristic":"","modifier":-10}}`),
	})
	if skipped != nil {
		t.Fatal(skipped)
	}
	entry, ok := getClientJSON(&gamedata.Catalog{PsychicPowers: idx}, "psychicPowers", "Delude (Bard)")
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
	if power.Name != "Delude (Bard)" || power.Subtypes != "Иллюзия, Arts (Bard)" || power.Level != 1 {
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

// kindAssets has a Black Crusade catalog in the root and a Pathfinder one
// without talents.
var kindAssets = fstest.MapFS{
	"assets/psychic_powers.json":                    {Data: []byte(`[{"name":"Fearful Aura","type":"Telepathy"}]`)},
	"assets/talents.json":                           {Data: []byte(`[{"name":"Ambidextrous"}]`)},
	"assets/pathfinder_crusade/psychic_powers.json": {Data: []byte(`[{"name":"Fear","type":"Иллюзия"}]`)},
}

func resultNames(t *testing.T, msg map[string]any) []string {
	t.Helper()
	results, ok := msg["results"].([]any)
	if !ok {
		t.Fatalf("no results in %v", msg)
	}
	names := []string{}
	for _, r := range results {
		names = append(names, r.(map[string]any)["name"].(string))
	}
	return names
}

func TestAutocompleteSearchesTheSheetKind(t *testing.T) {
	b := newBestiaryPages(t)
	b.server.Gamedata = gamedata.LoadFS(kindAssets)
	tab := b.dial(ownerID)

	tests := []struct {
		name, kind, collection, query string
		want                          []string
	}{
		// Clients loaded before the kinds send none.
		{"no kind is black crusade", "", "psychicPowers", "fear", []string{"Fearful Aura"}},
		{"black crusade", "black_crusade", "psychicPowers", "fear", []string{"Fearful Aura"}},
		{"pathfinder finds its own spells only", "pathfinder_crusade", "psychicPowers", "fear", []string{"Fear"}},
		{"black crusade talents", "black_crusade", "talents", "amb", []string{"Ambidextrous"}},
		{"pathfinder without the file", "pathfinder_crusade", "talents", "amb", []string{}},
	}
	for i, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			eventID := string(rune('a' + i))
			msg, _ := json.Marshal(map[string]string{
				"type": "autocomplete", "eventID": eventID, "kind": tt.kind, "collection": tt.collection, "query": tt.query,
			})
			tab.send(string(msg))
			got := resultNames(t, tab.expect("autocompleteResult", eventID))
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got %q, want %q", got, tt.want)
			}
		})
	}

	tab.send(`{"type":"autocomplete","eventID":"z","kind":"warhammer","collection":"psychicPowers","query":"fear"}`)
	expectRefused(t, tab, "z")
}

func TestAutocompleteApplyTakesTheSheetKind(t *testing.T) {
	b := newBestiaryPages(t)
	b.server.Gamedata = gamedata.LoadFS(kindAssets)
	tab := b.dial(ownerID)

	tab.send(`{"type":"autocompleteApply","eventID":"a1","sheetID":"40","path":"psykana.powers.items.p1","kind":"pathfinder_crusade","collection":"psychicPowers","name":"Fear","base":{}}`)
	msg := tab.expect("autocompleteApplied", "a1")
	if changes, _ := msg["changes"].(map[string]any); changes["type"] != "Иллюзия" {
		t.Errorf("got %v, want the Pathfinder entry", msg)
	}

	tab.send(`{"type":"autocompleteApply","eventID":"a2","sheetID":"40","path":"psykana.powers.items.p1","kind":"pathfinder_crusade","collection":"psychicPowers","name":"Fearful Aura","base":{}}`)
	if resp := tab.expect("response", "a2"); resp["OK"] != false || resp["code"] != "not_found" {
		t.Errorf("got %v, want the Black Crusade entry not found", resp)
	}

	tab.send(`{"type":"autocompleteApply","eventID":"a3","sheetID":"40","path":"psykana.powers.items.p1","kind":"warhammer","collection":"psychicPowers","name":"Fear","base":{}}`)
	expectRefused(t, tab, "a3")
}

// The sheet builds a spell's roll from its test text when it is picked, so the
// search hands the text over.
func TestPsychicPowerSearchHasPsychotest(t *testing.T) {
	g := gamedata.LoadFS(fstest.MapFS{
		"assets/psychic_powers.json": {Data: []byte(`[{"name":"Terrify","psychotest":"W–20 vs W+0"},{"name":"Telepathy"}]`)},
	})[models.KindBlackCrusade]

	got, err := searchCollection(g, "psychicPowers", "te")
	if err != nil {
		t.Fatal(err)
	}
	if want := `[{"name":"Terrify","type":"","psychotest":"W–20 vs W+0"},{"name":"Telepathy","type":""}]`; string(got) != want {
		t.Errorf("search got %s, want %s", got, want)
	}
}
