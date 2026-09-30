package gamedata

import (
	"encoding/json"
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
