package templates

import (
	"encoding/json"
	"html/template"
	"sort"

	"charactersheet.iociveteres.net/internal/models"
)

var defaultCols = map[string]int{
	"tabs":          1,
	"psychicPowers": 2,
	"techPowers":    2,
	"powers":        2,
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
			// A ghost: its item is gone. normalizeSheet drops it too.
			if _, ok := data[key]; !ok {
				continue
			}
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

// sheetStatePayload is the JSON the client builds the sheet state from.
type sheetStatePayload struct {
	Content      *models.CharacterSheetContent `json:"content"`
	RollDefaults rollDefaults                  `json:"rollDefaults"`
	CanEdit      bool                          `json:"canEdit"`
}

// rollDefaults are the roll settings a new attack or power starts with.
type rollDefaults struct {
	RangedAttack *models.RangedAttackRoll `json:"rangedAttack"`
	MeleeAttack  *models.MeleeAttackRoll  `json:"meleeAttack"`
	PsychicPower *models.PsychicPowerRoll `json:"psychicPower"`
	TechPower    *models.TechPowerRoll    `json:"techPower"`
}

// sheetState serializes the sheet for the #sheet-state script. The content is
// the struct the markup is rendered from. json.Marshal escapes <, > and &, so
// the output cannot close the script element.
func sheetState(content *models.CharacterSheetContent, canEdit bool) (template.JS, error) {
	payload := sheetStatePayload{
		Content: content,
		CanEdit: canEdit,
		RollDefaults: rollDefaults{
			RangedAttack: models.NewDefaultRangedAttackRoll(),
			MeleeAttack:  models.NewDefaultMeleeAttackRoll(),
			PsychicPower: models.NewDefaultPsychicPowerRoll(),
			TechPower:    models.NewDefaultTechPowerRoll(),
		},
	}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return template.JS(jsonData), nil
}
