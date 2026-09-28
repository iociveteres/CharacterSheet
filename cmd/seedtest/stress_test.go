package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

// The stress sheets are already in the current shape: InsertWithContent
// would store them as they are.
func TestStressSheetsNeedNoUpgrade(t *testing.T) {
	for _, p := range stressProfiles {
		t.Run(p.Name, func(t *testing.T) {
			content, err := json.Marshal(stressSheet("Stress "+p.Name, p.Scale))
			if err != nil {
				t.Fatal(err)
			}
			if err := models.ValidateCharacterSheetJSON(content); err != nil {
				t.Fatal(err)
			}
			upgraded, err := models.WithTestOptions(content, models.DefaultSheetKind)
			if err != nil {
				t.Fatal(err)
			}
			var before, after any
			if err := json.Unmarshal(content, &before); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(upgraded, &after); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Error("WithTestOptions changed the stress sheet")
			}
		})
	}
}

// Every power is tested on an option of its block, and every option on a
// custom skill names one the sheet has.
func TestStressSheetTestOptionsResolve(t *testing.T) {
	for _, p := range stressProfiles {
		t.Run(p.Name, func(t *testing.T) {
			sheet := stressSheet("Stress "+p.Name, p.Scale)
			blocks := map[string]models.ItemGrid[models.TestOption]{
				"psykana":      sheet.Psykana.TestOptions,
				"technoArcana": sheet.TechnoArcana.TestOptions,
			}
			for block, options := range blocks {
				for id, option := range options.Items {
					if skill, ok := strings.CutPrefix(option.Base, "custom:"); ok {
						if _, ok := sheet.CustomSkills.List.Items[skill]; !ok {
							t.Errorf("%s option %s: no custom skill %s", block, id, skill)
						}
					}
				}
			}
			for _, tab := range sheet.Psykana.Tabs.Items {
				for id, power := range tab.Powers.Items {
					if _, ok := sheet.Psykana.TestOptions.Items[power.Roll.TestOption]; !ok {
						t.Errorf("psychic power %s: no test option %s", id, power.Roll.TestOption)
					}
				}
			}
			for _, tab := range sheet.TechnoArcana.Tabs.Items {
				for id, power := range tab.Powers.Items {
					if _, ok := sheet.TechnoArcana.TestOptions.Items[power.Roll.TestOption]; !ok {
						t.Errorf("tech power %s: no test option %s", id, power.Roll.TestOption)
					}
				}
			}
		})
	}
}
