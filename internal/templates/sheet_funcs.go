package templates

import (
	"encoding/json"
	"html/template"
	"sort"

	"charactersheet.iociveteres.net/internal/models"
)

var defaultCols = map[string]int{
	"tabs":             1,
	"customSkills":     1,
	"notes":            1,
	"resourceTrackers": 2,
	"powerShields":     1,
	"rangedAttacks":    1,
	"meleeAttacks":     1,
	"traits":           3,
	"talents":          3,
	"gear":             3,
	"cybernetics":      3,
	"experienceLog":    3,
	"mutations":        1,
	"mentalDisorders":  1,
	"diseases":         1,
	"psychicPowers":    2,
	"techPowers":       2,
	"powers":           2,
	"conditions":       2,
}

// columnsFromLayout prepares column-first [][]string for templates.
//
// container: name like "custom-skills" used to look up defaultCols
// l: pointer to Layout (may be nil)
// data: map of items (primary source of keys)
func columnsFromLayout[T any](container string, positions map[string]models.Position, data map[string]T) [][]string {
	// determine colsCount
	colsCount := 1
	if v, ok := defaultCols[container]; ok && v > 0 {
		colsCount = v
	}

	// init columns
	cols := make([][]string, colsCount)
	for i := range cols {
		cols[i] = []string{}
	}

	if len(data) == 0 {
		return cols
	}

	// track placed keys
	present := make(map[string]struct{})

	// if positions exist, group them by column
	if len(positions) > 0 {
		type entry struct {
			row int
			key string
		}
		colsMap := make(map[int][]entry)
		for key, pos := range positions {
			ci := max(pos.ColIndex, 0)
			ci = min(ci, colsCount-1)
			colsMap[ci] = append(colsMap[ci], entry{row: pos.RowIndex, key: key})
		}
		// sort each column's entries by (row asc) once
		for c := 0; c < colsCount; c++ {
			entries := colsMap[c]
			if len(entries) == 0 {
				continue
			}

			sort.Slice(entries, func(i, j int) bool {
				if entries[i].row == entries[j].row {
					return entries[i].key < entries[j].key
				}
				return entries[i].row < entries[j].row
			})
			for _, e := range entries {
				cols[c] = append(cols[c], e.key)
				present[e.key] = struct{}{}
			}
		}
	}

	// collect missing keys (in data but not placed) and sort once
	missing := make([]string, 0, len(data))
	for k := range data {
		if _, ok := present[k]; !ok {
			missing = append(missing, k)
		}
	}
	sort.Strings(missing)

	// unified row-by-row placement for missing keys
	mIdx := 0
	for row := 0; mIdx < len(missing); row++ {
		for c := 0; c < colsCount && mIdx < len(missing); c++ {
			if len(cols[c]) == row {
				cols[c] = append(cols[c], missing[mIdx])
				mIdx++
			}
		}
	}

	return cols
}

// html/template can't register generic functions
// as they don't exist at runtime
// you could have avoided this if you used templ
func columnsFromLayoutNotes(container string, grid models.ItemGrid[models.Note]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutSkills(container string, grid models.ItemGrid[models.Skill]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutResourceTrackers(container string, grid models.ItemGrid[models.ResourceTracker]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutPowerShields(container string, grid models.ItemGrid[models.PowerShield]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutRangedAttacks(container string, grid models.ItemGrid[models.RangedAttack]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutMeleeAttacks(container string, grid models.ItemGrid[models.MeleeAttack]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutMeleeTabs(container string, grid models.ItemGrid[models.MeleeTab]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutNamedDescriptions(container string, grid models.ItemGrid[models.NamedDescription]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutGearItems(container string, grid models.ItemGrid[models.GearItem]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutCyberneticImplants(container string, grid models.ItemGrid[models.CyberneticImplant]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutExperienceItems(container string, grid models.ItemGrid[models.ExperienceItem]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutPsychicPowers(container string, grid models.ItemGrid[models.PsychicPower]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutTechPowers(container string, grid models.ItemGrid[models.TechPower]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutPsychicTabs(container string, grid models.ItemGrid[models.PsychicPowersTab]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutTechTabs(container string, grid models.ItemGrid[models.TechPowersTab]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutConditions(container string, grid models.ItemGrid[models.Condition]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func columnsFromLayoutConditionEntries(container string, grid models.ItemGrid[models.ConditionEntry]) [][]string {
	return columnsFromLayout(container, grid.Layouts, grid.Items)
}

func customSkillWithDefaults() models.Skill {
	return models.Skill{
		Name:           "",
		Characteristic: "WS",
		Plus0:          false,
		Plus10:         false,
		Plus20:         false,
		Plus30:         false,
		MiscBonus:      0,
		Difficulty:     0,
	}
}

func resourceTrackerWithDefaults() models.ResourceTracker {
	return models.ResourceTracker{
		Name:  "",
		Value: 0,
	}
}

func powerShieldWithDefaults() models.PowerShield {
	return models.PowerShield{
		Name:        "",
		Rating:      "",
		Nature:      "tech",
		Type:        "dome",
		Description: "",
	}
}

func rangedAttackWithDefaults() models.RangedAttack {
	return models.RangedAttack{
		Name:        "",
		Class:       "pistol",
		Range:       "",
		Damage:      "",
		Pen:         "",
		DamageType:  "I",
		RoFSingle:   "",
		RoFShort:    "",
		RoFLong:     "",
		ClipCur:     "",
		ClipMax:     "",
		Reload:      "",
		Special:     "",
		Upgrades:    "",
		Description: "",
		Roll:        models.NewDefaultRangedAttackRoll(),
	}
}

func meleeAttackWithDefaults() models.MeleeAttack {
	defaultTabID := "PLACEHOLDER_ID"

	return models.MeleeAttack{
		Name:     "",
		Group:    "primary",
		Grip:     "",
		Balance:  "",
		Upgrades: "",
		Tabs: models.ItemGrid[models.MeleeTab]{
			Items: map[string]models.MeleeTab{
				defaultTabID: {
					Profile:    "mace",
					Range:      "",
					Damage:     "",
					Pen:        "",
					DamageType: "I",
					Special:    "",
				},
			},
			Layouts: map[string]models.Position{
				defaultTabID: {
					ColIndex: 0,
					RowIndex: 0,
				},
			},
		},
		Description: "",
		Roll:        models.NewDefaultMeleeAttackRoll(),
	}
}

func talentWithDefaults() models.NamedDescription {
	return models.NamedDescription{
		Name:        "",
		Description: "",
	}
}

func gearItemWithDefaults() models.GearItem {
	return models.GearItem{
		Name:        "",
		Weight:      0,
		Description: "",
		Carried:     true,
	}
}

func cyberneticImplantWithDefaults() models.CyberneticImplant {
	return models.CyberneticImplant{
		Name:        "",
		Description: "",
		ConditionEntries: models.ItemGrid[models.ConditionEntry]{
			Items:   map[string]models.ConditionEntry{},
			Layouts: map[string]models.Position{},
		},
	}
}

func experienceItemWithDefaults() models.ExperienceItem {
	return models.ExperienceItem{
		Name:           "",
		ExperienceCost: 0,
	}
}

func psychicPowerWithDefaults() models.PsychicPower {
	return models.PsychicPower{
		Name:        "",
		Subtypes:    "",
		Range:       "",
		Psychotest:  "",
		Action:      "",
		Sustained:   "",
		WeaponRange: "",
		Damage:      "",
		Pen:         "",
		DamageType:  "I",
		RoFSingle:   "",
		RoFShort:    "",
		RoFLong:     "",
		Special:     "",
		Effect:      "",
		Roll:        models.NewDefaultPsychicPowerRoll(),
	}
}

func techPowerWithDefaults() models.TechPower {
	return models.TechPower{
		Name:        "",
		Subtypes:    "",
		Range:       "",
		Test:        "",
		Implants:    "",
		Price:       "",
		Process:     "",
		Action:      "",
		WeaponRange: "",
		Damage:      "",
		Pen:         "",
		DamageType:  "I",
		RoFSingle:   "",
		RoFShort:    "",
		RoFLong:     "",
		Special:     "",
		Effect:      "",
		Roll:        models.NewDefaultTechPowerRoll(),
	}
}

func conditionEntryWithDefaults() models.ConditionEntry {
	return models.ConditionEntry{
		Type: "bonus_unnatural",
		Name: "",
	}
}

func conditionWithDefaults() models.Condition {
	defaultEntryID := "PLACEHOLDER_ID"

	return models.Condition{
		Name:    "",
		Enabled: true,
		Stacks:  1,
		Entries: models.ItemGrid[models.ConditionEntry]{
			Items: map[string]models.ConditionEntry{
				defaultEntryID: conditionEntryWithDefaults(),
			},
			Layouts: map[string]models.Position{
				defaultEntryID: {ColIndex: 0, RowIndex: 0},
			},
		},
	}
}

func defaultRangedRollContent() template.JS {
	roll := models.NewDefaultRangedAttackRoll()
	jsonData, _ := json.Marshal(roll)
	return template.JS(jsonData)
}

func defaultMeleeRollContent() template.JS {
	roll := models.NewDefaultMeleeAttackRoll()
	jsonData, _ := json.Marshal(roll)
	return template.JS(jsonData)
}

func defaultPsychotestRollContent() template.JS {
	roll := models.NewDefaultPsychicPowerRoll()
	jsonData, _ := json.Marshal(roll)
	return template.JS(jsonData)
}

func defaultTechPowerRollContent() template.JS {
	roll := models.NewDefaultTechPowerRoll()
	jsonData, _ := json.Marshal(roll)
	return template.JS(jsonData)
}
