package models

import (
	"context"
	"encoding/json"
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
