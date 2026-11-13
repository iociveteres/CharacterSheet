package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"charactersheet.iociveteres.net/internal/models"
)

// The stress sheets are already in the current shape: InsertWithContent
// would store them as they are. The upgrades are those of currentShape in
// internal/models/character_sheets.go, in its order.
func TestStressSheetsNeedNoUpgrade(t *testing.T) {
	for _, p := range stressProfiles {
		t.Run(p.Name, func(t *testing.T) {
			content, err := json.Marshal(stressSheet("Stress "+p.Name, p.Kind, p.Scale))
			if err != nil {
				t.Fatal(err)
			}
			if err := models.ValidateCharacterSheetJSON(content); err != nil {
				t.Fatal(err)
			}
			upgrades := []func(json.RawMessage) (json.RawMessage, error){
				func(c json.RawMessage) (json.RawMessage, error) { return models.WithTestOptions(c, p.Kind) },
				func(c json.RawMessage) (json.RawMessage, error) { return models.WithAttackTestOptions(c, p.Kind) },
				models.WithResourceStats, models.WithFatigueThreshold, models.WithArmourMods,
				models.WithAttackUpgradesInDescription, models.WithMovementModes, models.WithStances,
			}
			upgraded := content
			for _, upgrade := range upgrades {
				if upgraded, err = upgrade(upgraded); err != nil {
					t.Fatal(err)
				}
			}
			var before, after any
			if err := json.Unmarshal(content, &before); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(upgraded, &after); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Error("an upgrade of currentShape changed the stress sheet")
			}
		})
	}
}

// Every power is tested on an option of its block, and every option on a
// custom skill names one the sheet has.
func TestStressSheetTestOptionsResolve(t *testing.T) {
	for _, p := range stressProfiles {
		t.Run(p.Name, func(t *testing.T) {
			sheet := stressSheet("Stress "+p.Name, p.Kind, p.Scale)
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

// Linked attacks name weapons of the gear list, each its own, and gear-04,
// whose weight a scenario types, has a plain weight: no mod or material
// changes it.
func TestStressSheetLinksResolve(t *testing.T) {
	for _, p := range stressProfiles {
		t.Run(p.Name, func(t *testing.T) {
			sheet := stressSheet("Stress "+p.Name, p.Kind, p.Scale)
			linked := map[string]string{}
			link := func(attack, item string) {
				if item == "" {
					return
				}
				if g, ok := sheet.Gear.List.Items[item]; !ok || g.Weapon == nil {
					t.Errorf("%s: %s is no weapon of the gear list", attack, item)
				}
				if other, ok := linked[item]; ok {
					t.Errorf("%s and %s are linked to %s", other, attack, item)
				}
				linked[item] = attack
			}
			for id, a := range sheet.RangedAttacks.List.Items {
				link(id, a.Item)
			}
			for id, a := range sheet.MeleeAttacks.List.Items {
				link(id, a.Item)
			}
			// Every other attack of each block, from the first.
			if want := (5*p.Scale + 1) / 2 * 2; len(linked) != want {
				t.Errorf("%d linked attacks, want %d", len(linked), want)
			}
			first := sheet.Gear.List.Items["gear-04"]
			if linked["gear-04"] != "ranged-01" || len(first.Weapon.Mods.Items) != 0 || first.Material != nil {
				t.Errorf("gear-04 is linked to %q, with %d mods and material %v", linked["gear-04"], len(first.Weapon.Mods.Items), first.Material)
			}
		})
	}
}
