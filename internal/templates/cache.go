package templates

import (
	"html/template"
	"io/fs"
	"maps"
	"path"
	"path/filepath"

	"charactersheet.iociveteres.net/internal/mailer"
	"charactersheet.iociveteres.net/internal/util"
	"charactersheet.iociveteres.net/ui"
	"github.com/alehano/reverse"
)

var functions = template.FuncMap{
	"humanDate":                     humanDate,
	"layoutNotes":                   columnsFromLayoutNotes,
	"layoutSkills":                  columnsFromLayoutSkills,
	"layoutResourceTrackers":        columnsFromLayoutResourceTrackers,
	"layoutPowerShields":            columnsFromLayoutPowerShields,
	"layoutRangedAttacks":           columnsFromLayoutRangedAttacks,
	"layoutMeleeAttacks":            columnsFromLayoutMeleeAttacks,
	"layoutMeleeTabs":               columnsFromLayoutMeleeTabs,
	"layoutNamedDescriptions":       columnsFromLayoutNamedDescriptions,
	"layoutGearItems":               columnsFromLayoutGearItems,
	"layoutCyberneticImplants":      columnsFromLayoutCyberneticImplants,
	"layoutExperienceItems":         columnsFromLayoutExperienceItems,
	"layoutPsychicPowers":           columnsFromLayoutPsychicPowers,
	"layoutTechPowers":              columnsFromLayoutTechPowers,
	"layoutPsychicTabs":             columnsFromLayoutPsychicTabs,
	"layoutTechTabs":                columnsFromLayoutTechTabs,
	"layoutConditions":              columnsFromLayoutConditions,
	"layoutConditionEntries":        columnsFromLayoutConditionEntries,
	"defaultRangedRollContent":      defaultRangedRollContent,
	"defaultMeleeRollContent":       defaultMeleeRollContent,
	"defaultPsychotestRollContent":  defaultPsychotestRollContent,
	"defaultTechPowerRollContent":   defaultTechPowerRollContent,
	"rangedAttackWithDefaults":      rangedAttackWithDefaults,
	"meleeAttackWithDefaults":       meleeAttackWithDefaults,
	"psychicPowerWithDefaults":      psychicPowerWithDefaults,
	"techPowerWithDefaults":         techPowerWithDefaults,
	"talentWithDefaults":            talentWithDefaults,
	"gearItemWithDefaults":          gearItemWithDefaults,
	"cyberneticImplantWithDefaults": cyberneticImplantWithDefaults,
	"customSkillWithDefaults":       customSkillWithDefaults,
	"experienceItemWithDefaults":    experienceItemWithDefaults,
	"resourceTrackerWithDefaults":   resourceTrackerWithDefaults,
	"powerShieldWithDefaults":       powerShieldWithDefaults,
	"conditionWithDefaults":         conditionWithDefaults,
	"conditionEntryWithDefaults":    conditionEntryWithDefaults,
	"dict":                          dict,
	"makeInviteLink":                util.MakeInviteLink,
	"reverseRev":                    reverse.Rev,
	"isElevated":                    isElevated,
	"isGamemaster":                  isGamemaster,
	"rfc3339":                       rfc3399,
	"str":                           str,
	"importMapJSON":                 func() template.HTML { return template.HTML(ui.ImportMapJSON()) },
}

func NewTemplateCache() (map[string]*template.Template, error) {
	maps.Copy(functions, ui.VersionFunc())

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
