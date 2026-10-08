package models

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/assert"
)

// oldSheet has powers as they were before test options: a fixed select's value.
const oldSheet = `{
	"psykana": {"basePR": 3, "tabs": {"items": {"t1": {"name": "Biomancy", "powers": {"items": {
		"p1": {"name": "Smite", "roll": {"baseSelect": "psyniscience", "modifier": 5}},
		"p2": {"roll": {"baseSelect": ""}},
		"p3": {"roll": {"baseSelect": "stealth"}},
		"p4": {"roll": {"modifier": 1}},
		"p5": {"name": "No roll"}
	}}}, "t2": {}}}},
	"technoArcana": {"tabs": {"items": {"t1": {"powers": {"items": {
		"p1": {"roll": {"baseSelect": "awareness (I)"}},
		"p2": {"roll": {"baseSelect": "Tech-Use"}}
	}}}}}}
}`

func withTestOptions(t *testing.T, content string) (CharacterSheetContent, string) {
	t.Helper()
	upgraded, err := WithTestOptions(json.RawMessage(content), KindBlackCrusade)
	assert.NilError(t, err)
	var sheet CharacterSheetContent
	assert.NilError(t, json.Unmarshal(upgraded, &sheet))
	return sheet, string(upgraded)
}

func TestWithTestOptionsSeedsANewSheet(t *testing.T) {
	sheet, _ := withTestOptions(t, defaultContent)

	assert.Equal(t, len(sheet.Psykana.TestOptions.Items), 5)
	assert.Equal(t, sheet.Psykana.TestOptions.Items["test-option-1"], TestOption{Base: "W"})
	assert.Equal(t, sheet.Psykana.TestOptions.Layouts["test-option-5"], Position{ColIndex: 0, RowIndex: 4})
	assert.Equal(t, sheet.TechnoArcana.TestOptions.Items["test-option-3"], TestOption{Base: "awareness", Characteristic: "I"})
	assert.Equal(t, sheet.CharacterInfo.CharacterName, "New Character")
}

func TestWithTestOptionsPointsPowersAtTheOptionOfTheirBaseSelect(t *testing.T) {
	sheet, raw := withTestOptions(t, oldSheet)

	psychic := sheet.Psykana.Tabs.Items["t1"].Powers.Items
	assert.Equal(t, psychic["p1"].Roll.TestOption, "test-option-3")
	assert.Equal(t, psychic["p1"].Roll.Modifier, 5)
	// The fixed select showed these as its first option.
	assert.Equal(t, psychic["p2"].Roll.TestOption, "test-option-1")
	assert.Equal(t, psychic["p3"].Roll.TestOption, "test-option-1")
	assert.Equal(t, psychic["p4"].Roll.TestOption, "test-option-1")
	assert.Equal(t, psychic["p5"].Roll == nil, true)
	assert.Equal(t, psychic["p5"].Name, "No roll")

	tech := sheet.TechnoArcana.Tabs.Items["t1"].Powers.Items
	assert.Equal(t, tech["p1"].Roll.TestOption, "test-option-3")
	assert.Equal(t, tech["p2"].Roll.TestOption, "test-option-1")

	assert.Equal(t, strings.Contains(raw, "baseSelect"), false)
	assert.Equal(t, sheet.Psykana.BasePR, 3)
}

func TestWithTestOptionsKeepsBlocksThatHaveThem(t *testing.T) {
	sheet, _ := withTestOptions(t, `{
		"psykana": {"testOptions": {"items": {}, "layouts": {}},
			"tabs": {"items": {"t1": {"powers": {"items": {"p1": {"roll": {"testOption": "gone"}}}}}}}},
		"technoArcana": null
	}`)

	assert.Equal(t, len(sheet.Psykana.TestOptions.Items), 0)
	assert.Equal(t, sheet.Psykana.Tabs.Items["t1"].Powers.Items["p1"].Roll.TestOption, "gone")
	assert.Equal(t, len(sheet.TechnoArcana.TestOptions.Items), 5)
}

func TestWithTestOptionsHasDefaultsForEveryKind(t *testing.T) {
	for _, info := range SheetKinds() {
		_, err := WithTestOptions(json.RawMessage(defaultContent), info.Kind)
		assert.NilError(t, err)
	}
}

// migrationFunction is the CREATE FUNCTION statement of `name` in a migration file.
func migrationFunction(t *testing.T, file, name string) string {
	t.Helper()
	src, err := os.ReadFile("../../migrations/" + file)
	assert.NilError(t, err)
	s := string(src)
	start := strings.Index(s, "CREATE OR REPLACE FUNCTION "+name)
	end := strings.Index(s[start:], "\n$$;")
	if start < 0 || end < 0 {
		t.Fatalf("no function %s in %s", name, file)
	}
	return s[start : start+end+len("\n$$;")]
}

func TestMigration30DoesWhatImportDoes(t *testing.T) {
	if testing.Short() {
		t.Skip("models: skipping integration test")
	}
	ctx := context.Background()
	tx, err := newTestDB(t).Begin(ctx)
	assert.NilError(t, err)
	defer tx.Rollback(ctx)
	for _, fn := range []string{
		migrationFunction(t, "000030_power_test_options.up.sql", "add_power_test_options"),
		migrationFunction(t, "000030_power_test_options.down.sql", "remove_power_test_options"),
	} {
		_, err := tx.Exec(ctx, fn)
		assert.NilError(t, err)
	}

	for name, content := range map[string]string{
		"new sheet":        defaultContent,
		"old powers":       oldSheet,
		"blocks with some": `{"psykana": {"testOptions": {"items": {}, "layouts": {}}}, "technoArcana": null}`,
	} {
		t.Run(name, func(t *testing.T) {
			want, err := WithTestOptions(json.RawMessage(content), KindBlackCrusade)
			assert.NilError(t, err)
			var same bool
			err = tx.QueryRow(ctx, "SELECT add_power_test_options($1::jsonb) = $2::jsonb", content, string(want)).Scan(&same)
			assert.NilError(t, err)
			assert.Equal(t, same, true)
		})
	}

	t.Run("down gives the values of the fixed selects back", func(t *testing.T) {
		var bases []string
		err := tx.QueryRow(ctx, `
			SELECT ARRAY[c #>> '{psykana,tabs,items,t1,powers,items,p1,roll,baseSelect}',
			             c #>> '{psykana,tabs,items,t1,powers,items,p3,roll,baseSelect}',
			             c #>> '{technoArcana,tabs,items,t1,powers,items,p1,roll,baseSelect}',
			             c #>> '{technoArcana,tabs,items,t1,powers,items,p2,roll,baseSelect}',
			             COALESCE(c #>> '{psykana,testOptions}', 'none')]
			FROM (SELECT remove_power_test_options(add_power_test_options($1::jsonb)) AS c) s`, oldSheet).Scan(&bases)
		assert.NilError(t, err)
		assert.Equal(t, strings.Join(bases, "|"), "psyniscience|W|awareness (I)|tech-use|none")
	})
}

// oldAttacks has attacks as they were before test options: a fixed select's value.
const oldAttacks = `{
	"rangedAttacks": {"list": {"items": {
		"r1": {"name": "Bolter", "roll": {"baseSelect": "acrobatics", "extra1": {"name": "Aim", "value": 10}}},
		"r2": {"roll": {"baseSelect": "WS"}},
		"r3": {"name": "No roll"}
	}}},
	"meleeAttacks": {"list": {"items": {
		"m1": {"roll": {"baseSelect": "F"}, "tabs": {"items": {"t1": {"profile": "mace"}}}},
		"m2": {"roll": {"baseSelect": ""}}
	}}}
}`

func withAttackTestOptions(t *testing.T, content string) (CharacterSheetContent, string) {
	t.Helper()
	upgraded, err := WithAttackTestOptions(json.RawMessage(content), KindBlackCrusade)
	assert.NilError(t, err)
	var sheet CharacterSheetContent
	assert.NilError(t, json.Unmarshal(upgraded, &sheet))
	return sheet, string(upgraded)
}

func TestWithAttackTestOptionsSeedsANewSheet(t *testing.T) {
	sheet, _ := withAttackTestOptions(t, defaultContent)

	assert.Equal(t, len(sheet.RangedAttacks.TestOptions.Items), 7)
	assert.Equal(t, sheet.RangedAttacks.TestOptions.Items["test-option-1"], TestOption{Base: "BS"})
	assert.Equal(t, sheet.RangedAttacks.TestOptions.Items["test-option-7"], TestOption{Base: "medicae", Characteristic: "BS"})
	assert.Equal(t, len(sheet.MeleeAttacks.TestOptions.Items), 6)
	assert.Equal(t, sheet.MeleeAttacks.TestOptions.Items["test-option-6"], TestOption{Base: "medicae", Characteristic: "WS"})
	assert.Equal(t, sheet.MeleeAttacks.TestOptions.Layouts["test-option-6"], Position{ColIndex: 0, RowIndex: 5})
	assert.Equal(t, sheet.CharacterInfo.CharacterName, "New Character")
}

func TestWithAttackTestOptionsPointsAttacksAtTheOptionOfTheirBaseSelect(t *testing.T) {
	sheet, raw := withAttackTestOptions(t, oldAttacks)

	ranged := sheet.RangedAttacks.List.Items
	assert.Equal(t, ranged["r1"].Roll.TestOption, "test-option-6")
	assert.Equal(t, ranged["r1"].Roll.Extra1, RollExtra{Name: "Aim", Value: 10})
	assert.Equal(t, ranged["r1"].Name, "Bolter")
	// The fixed select showed this as its first option.
	assert.Equal(t, ranged["r2"].Roll.TestOption, "test-option-1")
	assert.Equal(t, ranged["r3"].Roll == nil, true)

	melee := sheet.MeleeAttacks.List.Items
	assert.Equal(t, melee["m1"].Roll.TestOption, "test-option-5")
	assert.Equal(t, melee["m1"].Tabs.Items["t1"].Profile, "mace")
	assert.Equal(t, melee["m2"].Roll.TestOption, "test-option-1")

	assert.Equal(t, strings.Contains(raw, "baseSelect"), false)
}

func TestWithAttackTestOptionsKeepsBlocksThatHaveThem(t *testing.T) {
	sheet, _ := withAttackTestOptions(t, `{
		"rangedAttacks": {"testOptions": {"items": {}, "layouts": {}},
			"list": {"items": {"r1": {"roll": {"testOption": "gone"}}}}},
		"meleeAttacks": null
	}`)

	assert.Equal(t, len(sheet.RangedAttacks.TestOptions.Items), 0)
	assert.Equal(t, sheet.RangedAttacks.List.Items["r1"].Roll.TestOption, "gone")
	assert.Equal(t, len(sheet.MeleeAttacks.TestOptions.Items), 6)
}

func TestWithAttackTestOptionsHasDefaultsForEveryKind(t *testing.T) {
	for _, info := range SheetKinds() {
		_, err := WithAttackTestOptions(json.RawMessage(defaultContent), info.Kind)
		assert.NilError(t, err)
	}
}

func TestMigration41DoesWhatImportDoes(t *testing.T) {
	if testing.Short() {
		t.Skip("models: skipping integration test")
	}
	ctx := context.Background()
	tx, err := newTestDB(t).Begin(ctx)
	assert.NilError(t, err)
	defer tx.Rollback(ctx)
	for _, fn := range []string{
		migrationFunction(t, "000041_attack_test_options.up.sql", "add_attack_test_options"),
		migrationFunction(t, "000041_attack_test_options.down.sql", "remove_attack_test_options"),
	} {
		_, err := tx.Exec(ctx, fn)
		assert.NilError(t, err)
	}

	for name, content := range map[string]string{
		"new sheet":        defaultContent,
		"old attacks":      oldAttacks,
		"blocks with some": `{"rangedAttacks": {"testOptions": {"items": {}, "layouts": {}}}, "meleeAttacks": null}`,
	} {
		t.Run(name, func(t *testing.T) {
			want, err := WithAttackTestOptions(json.RawMessage(content), KindBlackCrusade)
			assert.NilError(t, err)
			var same bool
			err = tx.QueryRow(ctx, "SELECT add_attack_test_options($1::jsonb) = $2::jsonb", content, string(want)).Scan(&same)
			assert.NilError(t, err)
			assert.Equal(t, same, true)
		})
	}

	t.Run("down gives the values of the fixed selects back", func(t *testing.T) {
		var bases []string
		err := tx.QueryRow(ctx, `
			SELECT ARRAY[c #>> '{rangedAttacks,list,items,r1,roll,baseSelect}',
			             c #>> '{rangedAttacks,list,items,r2,roll,baseSelect}',
			             c #>> '{meleeAttacks,list,items,m1,roll,baseSelect}',
			             COALESCE(c #>> '{rangedAttacks,testOptions}', 'none')]
			FROM (SELECT remove_attack_test_options(add_attack_test_options($1::jsonb)) AS c) s`, oldAttacks).Scan(&bases)
		assert.NilError(t, err)
		assert.Equal(t, strings.Join(bases, "|"), "acrobatics|BS|F|none")
	})
}

func TestWithResourceStatsMovesTypedMaximumsToTheirBase(t *testing.T) {
	raw, err := WithResourceStats(json.RawMessage(`{
		"characterInfo": {"characterName": "Magos"},
		"technoArcana": {"currentCognition": 4, "maxCognition": 12, "restoreCognition": 3, "maxEnergy": 0, "currentEnergy": 2}
	}`))
	assert.NilError(t, err)
	var sheet CharacterSheetContent
	assert.NilError(t, json.Unmarshal(raw, &sheet))

	assert.Equal(t, sheet.TechnoArcana.CognitionMax.Base, "12")
	// 0 was the maximum of a sheet that never typed one: the default of the rules counts.
	assert.Equal(t, sheet.TechnoArcana.EnergyMax.Base, "")
	assert.Equal(t, sheet.TechnoArcana.CognitionRestore.Base, "")
	assert.Equal(t, sheet.TechnoArcana.CurrentCognition, 4)
	assert.Equal(t, sheet.CharacterInfo.CharacterName, "Magos")
	for _, old := range []string{"maxCognition", "restoreCognition", "maxEnergy"} {
		assert.Equal(t, strings.Contains(string(raw), old), false)
	}
}

func TestWithResourceStatsLeavesCurrentSheetsAsTheyAre(t *testing.T) {
	for _, content := range []string{`{"technoArcana": {"cognitionMax": {"base": "I.b"}}}`, `{"technoArcana": null}`, `{}`} {
		raw, err := WithResourceStats(json.RawMessage(content))
		assert.NilError(t, err)
		assert.Equal(t, string(raw), content)
	}
}

// oldFatigue has T 45 and W 38 with an unnatural of 1: T.b+W.b is 4+3+1.
const oldFatigue = `{
	"characteristics": {"T": {"value": "45"}, "W": {"value": "38", "unnatural": "1"}},
	"fatigue": {"fatigueCur": 2, "fatigueMax": %d, "fatigueMode": "mental"}
}`

func TestWithFatigueThresholdKeepsOnlyAThresholdOtherThanTheRules(t *testing.T) {
	for typed, base := range map[int]string{9: "9", 8: "", 0: ""} {
		raw, err := WithFatigueThreshold(json.RawMessage(fmt.Sprintf(oldFatigue, typed)))
		assert.NilError(t, err)
		var sheet CharacterSheetContent
		assert.NilError(t, json.Unmarshal(raw, &sheet))

		assert.Equal(t, sheet.Fatigue.Threshold.Base, base)
		assert.Equal(t, sheet.Fatigue.FatigueCur, 2)
		assert.Equal(t, sheet.Fatigue.FatigueMode, "mental")
		assert.Equal(t, strings.Contains(string(raw), "fatigueMax"), false)
	}
}

func TestWithFatigueThresholdLeavesCurrentSheetsAsTheyAre(t *testing.T) {
	for _, content := range []string{`{"fatigue": {"threshold": {"base": "T.b"}}}`, `{"fatigue": null}`, `{}`} {
		raw, err := WithFatigueThreshold(json.RawMessage(content))
		assert.NilError(t, err)
		assert.Equal(t, string(raw), content)
	}
}

func TestMigration40DoesWhatImportDoes(t *testing.T) {
	if testing.Short() {
		t.Skip("models: skipping integration test")
	}
	ctx := context.Background()
	tx, err := newTestDB(t).Begin(ctx)
	assert.NilError(t, err)
	defer tx.Rollback(ctx)
	for _, fn := range []string{
		migrationFunction(t, "000040_fatigue_threshold.up.sql", "fatigue_threshold"),
		migrationFunction(t, "000040_fatigue_threshold.down.sql", "fatigue_threshold_number"),
	} {
		_, err := tx.Exec(ctx, fn)
		assert.NilError(t, err)
	}

	for _, typed := range []int{9, 8, 0} {
		content := fmt.Sprintf(oldFatigue, typed)
		want, err := WithFatigueThreshold(json.RawMessage(content))
		assert.NilError(t, err)
		var same bool
		err = tx.QueryRow(ctx, "SELECT fatigue_threshold($1::jsonb) = $2::jsonb", content, string(want)).Scan(&same)
		assert.NilError(t, err)
		assert.Equal(t, same, true)
	}

	t.Run("down gives a number back, T.b+W.b for an empty base", func(t *testing.T) {
		for typed, back := range map[int]int{9: 9, 8: 8, 0: 8} {
			var got int
			err := tx.QueryRow(ctx, `SELECT (fatigue_threshold_number(fatigue_threshold($1::jsonb)) #>> '{fatigue,fatigueMax}')::int`,
				fmt.Sprintf(oldFatigue, typed)).Scan(&got)
			assert.NilError(t, err)
			assert.Equal(t, got, back)
		}
	})
}
