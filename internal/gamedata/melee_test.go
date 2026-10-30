package gamedata

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

func TestMeleeClientJSONAddsStrengthBonusToEachProfile(t *testing.T) {
	var m Melee
	raw := json.RawMessage(`{"name":"Chainaxe","group":"Chain","tabs":[{"profile":"axe","damage":"1d10+4"},{"profile":"no","damage":"1d5"}]}`)
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	m.initRaw(raw)

	var got struct {
		Group string `json:"group"`
		Tabs  struct {
			Items map[string]models.MeleeTab `json:"items"`
		} `json:"tabs"`
	}
	if err := json.Unmarshal(m.ClientJSON(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Group != "chain" || len(got.Tabs.Items) != 2 {
		t.Fatalf("got group %q and %d tabs, want chain and 2", got.Group, len(got.Tabs.Items))
	}

	modIDs := map[string]bool{}
	for tabID, tab := range got.Tabs.Items {
		if !strings.HasPrefix(tabID, "tab-") {
			t.Errorf("tab id %q, want tab-<nanoid>", tabID)
		}
		if len(tab.DamageMods.Items) != 1 {
			t.Fatalf("tab %s (%s) has %d damage mods, want 1", tabID, tab.Damage, len(tab.DamageMods.Items))
		}
		for id, mod := range tab.DamageMods.Items {
			if !strings.HasPrefix(id, "damage-mod-") || modIDs[id] {
				t.Errorf("damage mod id %q, want a new damage-mod-<nanoid>", id)
			}
			modIDs[id] = true
			if mod != (models.WeaponMod{Expr: "S.b", Enabled: true}) {
				t.Errorf("damage mod %+v, want an enabled S.b", mod)
			}
			if pos, ok := tab.DamageMods.Layouts[id]; !ok || pos != (models.Position{}) {
				t.Errorf("layout of %s is %+v (%v), want the first row", id, pos, ok)
			}
		}
	}
}

func naturalMelee(t *testing.T, raw string) *Melee {
	t.Helper()
	var m Melee
	if err := json.Unmarshal(json.RawMessage(raw), &m); err != nil {
		t.Fatal(err)
	}
	m.initRaw(json.RawMessage(raw))
	return &m
}

type ratedTab struct {
	DamageMods models.ItemGrid[models.WeaponMod]  `json:"damageMods"`
	PenMods    *models.ItemGrid[models.WeaponMod] `json:"penMods"`
}

// ratedProfile is the one profile of the entry rated with rating.
func ratedProfile(t *testing.T, m *Melee, rating string) (ratedTab, map[string]any) {
	t.Helper()
	var got struct {
		Tabs struct {
			Items map[string]ratedTab `json:"items"`
		} `json:"tabs"`
	}
	b := m.RatedJSON(rating)
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	var keys map[string]any
	_ = json.Unmarshal(b, &keys)
	if len(got.Tabs.Items) != 1 {
		t.Fatalf("%d tabs, want 1", len(got.Tabs.Items))
	}
	for _, tab := range got.Tabs.Items {
		return tab, keys
	}
	return ratedTab{}, keys
}

// exprs are the mods of g in row order.
func exprs(g models.ItemGrid[models.WeaponMod]) []models.WeaponMod {
	out := make([]models.WeaponMod, len(g.Items))
	for id, mod := range g.Items {
		out[g.Layouts[id].RowIndex] = mod
	}
	return out
}

func TestMeleeRatedJSONPutsTheTraitRatingIntoTheModifiers(t *testing.T) {
	natural := naturalMelee(t, `{"name":"Claws (Natural Weapons)","entryType":"Трейт","trait":"Natural Weapons (X)","tabs":[{"profile":"claws","damage":"1d10","pen":"0"}]}`)
	deadly := naturalMelee(t, `{"name":"Claws (Deadly Natural Weapons)","entryType":"Трейт","trait":"Deadly Natural Weapons (X)","tabs":[{"profile":"claws","damage":"1d10","pen":"0"}]}`)
	sb := models.WeaponMod{Expr: "S.b", Enabled: true}

	tests := []struct {
		name   string
		m      *Melee
		rating string
		damage []models.WeaponMod
		pen    []models.WeaponMod
	}{
		{"natural with a number", natural, "2", []models.WeaponMod{sb, {Expr: "2", Enabled: true}}, nil},
		{"deadly with a number", deadly, "3", []models.WeaponMod{sb, {Expr: "3", Enabled: true}}, []models.WeaponMod{{Expr: "3", Enabled: true}}},
		{"no trait on the sheet", deadly, "X", []models.WeaponMod{sb, {Expr: "X"}}, []models.WeaponMod{{Expr: "X"}}},
		{"no rating", deadly, "", []models.WeaponMod{sb}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tab, keys := ratedProfile(t, tt.m, tt.rating)
			if got := exprs(tab.DamageMods); !reflect.DeepEqual(got, tt.damage) {
				t.Errorf("damage mods %+v, want %+v", got, tt.damage)
			}
			var pen []models.WeaponMod
			if tab.PenMods != nil {
				pen = exprs(*tab.PenMods)
			}
			if !reflect.DeepEqual(pen, tt.pen) {
				t.Errorf("pen mods %+v, want %+v", pen, tt.pen)
			}
			// The attack's own trait field is the link to the sheet's trait, not this name.
			if _, ok := keys["trait"]; ok {
				t.Errorf("the client JSON has trait: %v", keys["trait"])
			}
		})
	}
}

func TestMeleeRatedJSONIgnoresTheRatingOfAWeapon(t *testing.T) {
	m := naturalMelee(t, `{"name":"Longsword","tabs":[{"profile":"sword","damage":"1d10+2"}]}`)
	tab, _ := ratedProfile(t, m, "2")
	if got := exprs(tab.DamageMods); len(got) != 1 || tab.PenMods != nil {
		t.Errorf("damage mods %+v, pen mods %+v; want only S.b", got, tab.PenMods)
	}
}

func TestMeleeSearchResultsNameTheTrait(t *testing.T) {
	idx, skipped := NewIndex[Melee](
		[]json.RawMessage{json.RawMessage(`{"name":"Claws (Natural Weapons)","entryType":"Трейт","trait":"Natural Weapons (X)","tabs":[]}`)},
	)
	if len(skipped) > 0 {
		t.Fatal(skipped)
	}
	b, err := json.Marshal(idx.Search("claws", 10))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"trait":"Natural Weapons (X)"`) {
		t.Errorf("search results %s lack the trait", b)
	}
}
