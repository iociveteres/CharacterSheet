package gamedata

import (
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

// Each level carries its own entries; a level's bad entry is left out and
// named by the level.
func TestEnchantmentClientJSONMakesEntriesOfEachLevel(t *testing.T) {
	_, pf := pfCatalog(t, fstest.MapFS{
		"assets/pathfinder_crusade/enchantments.json": {Data: []byte(enchantmentsAsset)},
	})
	hasWarnings(t, pf, `pathfinder_crusade/enchantments.json: Controlling: skipped condition level 1: entry 0: unknown type "Teleport"`)

	var e struct {
		EntryType string            `json:"entryType"`
		Levels    []json.RawMessage `json:"levels"`
	}
	if err := json.Unmarshal(pf.Enchantments.GetByName("Controlling").ClientJSON(), &e); err != nil {
		t.Fatal(err)
	}
	if e.EntryType != "Ближнее оружие, Щиты" || len(e.Levels) != 2 {
		t.Fatalf("enchantment %+v", e)
	}
	level, g := entriesOf(t, e.Levels[0])
	if _, ok := level["conditions"]; ok {
		t.Error("conditions is still there")
	}
	if string(level["capacity"]) != "2" || len(g.Items) != 1 {
		t.Errorf("level 0 %s with %d entries", level["capacity"], len(g.Items))
	}
	for _, entry := range g.Items {
		if entry != (models.ConditionEntry{Type: "weapon_bonus", Name: "This item", WeaponField: "rngMax", WeaponBonus: "1"}) {
			t.Errorf("entry %+v", entry)
		}
	}
	if _, g := entriesOf(t, e.Levels[1]); len(g.Items) != 0 {
		t.Errorf("level 1 entries %+v, want none", g.Items)
	}

	// A level without conditions gets an empty grid.
	if err := json.Unmarshal(pf.Enchantments.GetByName("flaming").ClientJSON(), &e); err != nil {
		t.Fatal(err)
	}
	if level, g := entriesOf(t, e.Levels[0]); len(g.Items) != 0 || string(level["special"]) != `"Flame (d5)"` {
		t.Errorf("flaming level %v, entries %+v", level, g.Items)
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
