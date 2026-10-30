package gamedata

import (
	"bytes"
	"encoding/json"
	"testing"
	"testing/fstest"

	"charactersheet.iociveteres.net/internal/models"
)

const materialsAsset = `[
	{"name":"Mithral","name_ru":"Мифрил","entryType":"Металл","weightFactor":0.5,"ap":1,"pen":1,
	 "conditions":[{"type":"SkillBonus","name":"Stealth","value":"5"}]},
	{"name":"Leather","name_ru":"Кожа","entryType":"Кожа","ap":0,"pen":null,"conditions":[]},
	{"name":"Quartz","name_ru":"Кварц","entryType":"Инкрустация","rarity":0,"price":1500,"capacityBonus":1},
	{"name":"Ruby","name_ru":"Рубин","entryType":"Инкрустация","rarity":2,"price":6000,"capacityBonus":4}
]`

const enchantmentsAsset = `[
	{"name":"Controlling","entryType":"Ближнее оружие, Щиты","short":"+1 / +2","levels":[
		{"capacity":2,"text":"+1.","special":"","conditions":[{"type":"WeaponBonus","name":"This item","field":"rngMax","value":"1"}]},
		{"capacity":4,"text":"+2.","special":"","conditions":[{"type":"Teleport"}]}
	]},
	{"name":"Flaming","entryType":"Оружие","short":"Flame","levels":[
		{"capacity":1,"text":"Flame (d5).","special":"Flame (d5)"}
	]}
]`

func pfCatalog(t *testing.T, files fstest.MapFS) (bc, pf *Catalog) {
	t.Helper()
	cs := LoadFS(files)
	return cs[models.KindBlackCrusade], cs[models.KindPathfinderCrusade]
}

// The gems of materials.json are not materials: the material search never
// offers one, the inlay search offers only them.
func TestLoadMaterialsSplitsTheInlays(t *testing.T) {
	_, pf := pfCatalog(t, fstest.MapFS{
		"assets/pathfinder_crusade/materials.json": {Data: []byte(materialsAsset)},
	})
	if len(pf.Warnings) != 0 {
		t.Fatalf("warnings %q", pf.Warnings)
	}
	if pf.Materials.GetByName("Mithral") == nil || pf.Materials.GetByName("Quartz") != nil {
		t.Errorf("materials %+v, want Mithral and Leather only", pf.Materials.data)
	}
	if got := pf.Materials.Search("р", 10); len(got) != 1 || got[0].Name != "Mithral" {
		t.Errorf("materials search %+v, want only Мифрил", got)
	}
	if pf.Inlays.GetByName("Ruby") == nil || pf.Inlays.GetByName("Mithral") != nil {
		t.Errorf("inlays %+v, want Quartz and Ruby only", pf.Inlays.data)
	}
	var ruby map[string]any
	if err := json.Unmarshal(pf.Inlays.GetByName("ruby").ClientJSON(), &ruby); err != nil || ruby["capacityBonus"] != 4.0 {
		t.Errorf("ruby %v, %v", ruby, err)
	}
}

func TestMaterialClientJSONMakesEntries(t *testing.T) {
	_, pf := pfCatalog(t, fstest.MapFS{
		"assets/pathfinder_crusade/materials.json": {Data: []byte(materialsAsset)},
	})
	m, g := entriesOf(t, pf.Materials.GetByName("mithral").ClientJSON())
	if _, ok := m["conditions"]; ok {
		t.Error("conditions is still there")
	}
	if string(m["weightFactor"]) != "0.5" || string(m["entryType"]) != `"Металл"` {
		t.Errorf("fields did not pass through: %s", m["weightFactor"])
	}
	if len(g.Items) != 1 {
		t.Fatalf("got %d entries, want 1", len(g.Items))
	}
	for _, e := range g.Items {
		if e != (models.ConditionEntry{Type: "skill_bonus", Name: "Stealth", SkillBonus: "5"}) {
			t.Errorf("entry %+v", e)
		}
	}
}

// The enchantment comes as a gear item keeps it: every level with its own
// entries, the first one chosen and copied to the enchantment's fields. A
// level's bad entry is left out and named by the level.
func TestEnchantmentClientJSONIsTheGearEnchantment(t *testing.T) {
	_, pf := pfCatalog(t, fstest.MapFS{
		"assets/pathfinder_crusade/enchantments.json": {Data: []byte(enchantmentsAsset)},
	})
	hasWarnings(t, pf, `pathfinder_crusade/enchantments.json: Controlling: skipped condition level 1: entry 0: unknown type "Teleport"`)

	raw := pf.Enchantments.GetByName("Controlling").ClientJSON()
	for _, key := range []string{`"conditions"`, `"entryType"`, `"short"`} {
		if bytes.Contains(raw, []byte(key)) {
			t.Errorf("%s is still there: %s", key, raw)
		}
	}
	var e models.GearEnchantment
	if err := json.Unmarshal(raw, &e); err != nil {
		t.Fatal(err)
	}
	if e.Name != "Controlling" || len(e.Levels.Items) != 2 {
		t.Fatalf("enchantment %+v", e)
	}
	var first, second models.GearEnchantmentLevel
	for id, pos := range e.Levels.Layouts {
		if pos.RowIndex == 0 {
			first = e.Levels.Items[id]
			if e.Level != id {
				t.Errorf("chosen level %q, want the first, %q", e.Level, id)
			}
		} else {
			second = e.Levels.Items[id]
		}
	}
	if first.Capacity != 2 || first.Text != "+1." || len(first.ConditionEntries.Items) != 1 {
		t.Errorf("level 0 %+v", first)
	}
	for _, entry := range first.ConditionEntries.Items {
		if entry != (models.ConditionEntry{Type: "weapon_bonus", Name: "This item", WeaponField: "rngMax", WeaponBonus: "1"}) {
			t.Errorf("entry %+v", entry)
		}
	}
	if second.Capacity != 4 || len(second.ConditionEntries.Items) != 0 {
		t.Errorf("level 1 %+v, want no entries", second)
	}
	if e.Capacity != 2 || e.Description != "+1." || e.WeightFactor != nil || len(e.ConditionEntries.Items) != 1 {
		t.Errorf("the enchantment's own fields %+v, want level 0's", e)
	}
}

// The text before the levels leads every level's text; a weight factor of 0
// stays.
func TestEnchantmentClientJSONKeepsTheIntroAndWeightlessness(t *testing.T) {
	_, pf := pfCatalog(t, fstest.MapFS{
		"assets/pathfinder_crusade/enchantments.json": {Data: []byte(`[
			{"name":"Feather","levels":[{"capacity":11,"text":"0 kg.","special":"","weightFactor":0}]},
			{"name":"Greater Accuracy","requirement":"оружие без Inaccurate","description":"Только луки.","levels":[{"capacity":5,"text":"Accurate.","special":"Accurate"}]},
			{"name":"Muted","description":"Тихо.","levels":[]}
		]`)},
	})
	var e models.GearEnchantment
	if err := json.Unmarshal(pf.Enchantments.GetByName("feather").ClientJSON(), &e); err != nil {
		t.Fatal(err)
	}
	if e.WeightFactor == nil || *e.WeightFactor != 0 || e.Levels.Items[e.Level].WeightFactor == nil {
		t.Errorf("feather %+v, want the weight factor 0", e)
	}
	if err := json.Unmarshal(pf.Enchantments.GetByName("greater accuracy").ClientJSON(), &e); err != nil {
		t.Fatal(err)
	}
	if want := "Требование: оружие без Inaccurate.\nТолько луки.\nAccurate."; e.Description != want || e.Levels.Items[e.Level].Text != want || e.Special != "Accurate" {
		t.Errorf("greater accuracy %+v", e)
	}
	e = models.GearEnchantment{}
	if err := json.Unmarshal(pf.Enchantments.GetByName("muted").ClientJSON(), &e); err != nil {
		t.Fatal(err)
	}
	if e.Level != "" || e.Description != "Тихо." || len(e.Levels.Items) != 0 {
		t.Errorf("muted %+v", e)
	}
}

func TestEnchantmentWithBadLevelsIsSkipped(t *testing.T) {
	_, pf := pfCatalog(t, fstest.MapFS{
		"assets/pathfinder_crusade/enchantments.json": {Data: []byte(`[{"name":"Brutal","levels":{"capacity":3}},{"name":"Muted","levels":[]}]`)},
	})
	hasWarnings(t, pf, "pathfinder_crusade/enchantments.json: skipped entry 0: json: ")
	if pf.Enchantments.GetByName("Brutal") != nil || pf.Enchantments.GetByName("Muted") == nil {
		t.Errorf("enchantments %+v, want Muted only", pf.Enchantments.data)
	}
}

// Black Crusade has no materials, inlays and enchantments: it never reads
// them from the Pathfinder folder.
func TestMaterialsArePathfinderOnly(t *testing.T) {
	bc, pf := pfCatalog(t, fstest.MapFS{
		"assets/pathfinder_crusade/materials.json":    {Data: []byte(materialsAsset)},
		"assets/pathfinder_crusade/enchantments.json": {Data: []byte(`[{"name":"Muted","levels":[]}]`)},
	})
	if bc.Materials != nil || bc.Inlays != nil || bc.Enchantments != nil {
		t.Error("black crusade got materials, inlays or enchantments")
	}
	if got := bc.Materials.Search("mith", 10); got != nil {
		t.Errorf("black crusade materials search = %v", got)
	}
	if pf.Materials == nil || pf.Inlays == nil || pf.Enchantments.GetByName("Muted") == nil {
		t.Error("pathfinder did not load them")
	}
}
