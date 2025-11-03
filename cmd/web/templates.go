package main

import (
	"html/template"
	"io/fs"
	"path"
	"path/filepath"
	"sort"
	"time"

	"charactersheet.iociveteres.net/internal/commands"
	"charactersheet.iociveteres.net/internal/mailer"
	"charactersheet.iociveteres.net/internal/models"
	"charactersheet.iociveteres.net/ui"
	"github.com/alehano/reverse"
)

type templateData struct {
	CurrentYear             int
	CharacterSheet          *models.CharacterSheet
	CharacterSheets         []*models.CharacterSheet
	CharacterSheetSummaries []*models.CharacterSheetSummary
	CharacterSheetContent   *models.CharacterSheetContent
	CanEditSheet            bool
	Room                    *models.Room
	RoomInvite              *models.RoomInvite
	InviteLink              string
	MessagePage             *models.MessagePage
	AvailableCommands       []commands.Command
	Rooms                   []*models.Room
	PlayerViews             []*models.PlayerView
	CurrentPlayerView       *models.PlayerView
	Form                    any
	Flash                   string
	IsAuthenticated         bool
	CSRFToken               string
	User                    *models.User
	TimeZone                *time.Location
	HideLayout              bool
	Token                   string
}

const humanDateLayout = "02 Jan 2006 at 15:04"

func humanDate(t time.Time, loc *time.Location) string {
	if t.IsZero() {
		return ""
	}
	if loc == nil {
		loc = time.UTC
	}
	return t.In(loc).Format(humanDateLayout)
}

var defaultCols = map[string]int{
	"custom-skills":    1,
	"notes":            1,
	"ranged-attack":    1,
	"melee-attack":     1,
	"traits":           3,
	"talents":          3,
	"gear":             3,
	"cybernetics":      3,
	"experience-log":   3,
	"mutations":        1,
	"mental-disorders": 1,
	"diseases":         1,
	"psychic-powers":   2,
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
func columnsFromLayoutNotes(container string, positions map[string]models.Position, data map[string]models.Note) [][]string {
	return columnsFromLayout(container, positions, data)
}

func columnsFromLayoutSkills(container string, positions map[string]models.Position, data map[string]models.Skill) [][]string {
	return columnsFromLayout(container, positions, data)
}

func columnsFromLayoutRangedAttacks(container string, positions map[string]models.Position, data map[string]models.RangedAttack) [][]string {
	return columnsFromLayout(container, positions, data)
}

func columnsFromLayoutMeleeAttacks(container string, positions map[string]models.Position, data map[string]models.MeleeAttack) [][]string {
	return columnsFromLayout(container, positions, data)
}

func columnsFromLayoutNamedDescriptions(container string, positions map[string]models.Position, data map[string]models.NamedDescription) [][]string {
	return columnsFromLayout(container, positions, data)
}

func columnsFromLayoutGearItems(container string, positions map[string]models.Position, data map[string]models.GearItem) [][]string {
	return columnsFromLayout(container, positions, data)
}

func columnsFromLayoutExperienceItems(container string, positions map[string]models.Position, data map[string]models.ExperienceItem) [][]string {
	return columnsFromLayout(container, positions, data)
}

func columnsFromLayoutPsychicPowers(container string, positions map[string]models.Position, data map[string]models.PsychicPower) [][]string {
	return columnsFromLayout(container, positions, data)
}

func dict(values ...interface{}) map[string]interface{} {
	m := make(map[string]interface{}, len(values)/2)
	for i := 0; i < len(values); i += 2 {
		k, ok := values[i].(string)
		if !ok || i+1 >= len(values) {
			continue
		}
		m[k] = values[i+1]
	}
	return m
}

func makeInviteLink(token string, origin string) string {
	return origin + reverse.Rev("RedeemInvite", token)
}

func isElevated(role models.RoomRole) bool {
	return role == models.RoleGamemaster || role == models.RoleModerator
}

func isGamemaster(role models.RoomRole) bool {
	return role == models.RoleGamemaster
}

func rfc3399(t time.Time) string {
	return t.Format(time.RFC3339)
}

var functions = template.FuncMap{
	"humanDate":               humanDate,
	"layoutNotes":             columnsFromLayoutNotes,
	"layoutSkills":            columnsFromLayoutSkills,
	"layoutRangedAttacks":     columnsFromLayoutRangedAttacks,
	"layoutMeleeAttacks":      columnsFromLayoutMeleeAttacks,
	"layoutNamedDescriptions": columnsFromLayoutNamedDescriptions,
	"layoutGearItems":         columnsFromLayoutGearItems,
	"layoutExperienceItems":   columnsFromLayoutExperienceItems,
	"layoutPsychicPowers":     columnsFromLayoutPsychicPowers,
	"dict":                    dict,
	"makeInviteLink":          makeInviteLink,
	"reverseRev":              reverse.Rev,
	"isElevated":              isElevated,
	"isGamemaster":            isGamemaster,
	"rfc3339":                 rfc3399,
}

func newTemplateCache() (map[string]*template.Template, error) {
	root, err := template.
		New("root").
		Funcs(functions).
		ParseFS(ui.Files,
			"html/base.html",
			"html/partials/*.html",
			"html/sheet/*.html",
			"html/pages/*.html",
		)
	if err != nil {
		return nil, err
	}

	cache := map[string]*template.Template{}
	templatePages, _ := fs.Glob(ui.Files, "html/pages/*.html")
	for _, page := range templatePages {
		name := filepath.Base(page)
		ts, err := root.Clone()
		if err != nil {
			return nil, err
		}
		if _, err := ts.ParseFS(ui.Files, page); err != nil {
			return nil, err
		}
		cache[name] = ts
	}

	mailPages, _ := fs.Glob(mailer.Templates, "templates/*.html")
	for _, page := range mailPages {
		name := path.Base(page)
		ts, err := root.Clone()
		if err != nil {
			return nil, err
		}
		if _, err := ts.ParseFS(mailer.Templates, page); err != nil {
			return nil, err
		}
		cache["mail/"+name] = ts
	}

	return cache, nil
}
