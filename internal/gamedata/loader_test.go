package gamedata

import (
	"maps"
	"reflect"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
)

// hasWarnings checks that warnings are prefixes, in order, of c.Warnings: the
// rest of a line is a json error message.
func hasWarnings(t *testing.T, c *Catalog, prefixes ...string) {
	t.Helper()
	if len(c.Warnings) != len(prefixes) {
		t.Fatalf("warnings %q, want %d starting with %q", c.Warnings, len(prefixes), prefixes)
	}
	for i, p := range prefixes {
		if !strings.HasPrefix(c.Warnings[i], p) {
			t.Errorf("warning %d = %q, want it to start with %q", i, c.Warnings[i], p)
		}
	}
}

func TestLoadSkipsMalformedFiles(t *testing.T) {
	c := loadFrom(fstest.MapFS{
		"assets/conditions.json": {Data: []byte(conditionsAsset)},
		"assets/gear.json":       {Data: []byte(`{"name":"Rope"}`)},
		"assets/talents.json":    {Data: []byte(`[{"name":"Ambidextrous"},`)},
		"assets/traits.json":     {Data: []byte(`[{"name":"Dark-sight"}]`)},
		"assets/melee.json":      {Data: []byte(``)},
	})
	hasWarnings(t, c,
		"gear.json: skipped the file: ",
		"melee.json: skipped the file: EOF",
		"talents.json: skipped the file: ",
		`conditions.json: Stunned: skipped condition entry 0: unknown type "Teleport"`,
	)

	// The other files still load.
	if c.Conditions.GetByName("Stunned") == nil {
		t.Error("conditions did not load")
	}
	if c.Collections["traits"].GetByName("dark-sight") == nil {
		t.Error("traits did not load")
	}

	// A skipped file leaves its collection as a missing one does.
	missing := loadFrom(fstest.MapFS{
		"assets/conditions.json": {Data: []byte(conditionsAsset)},
		"assets/traits.json":     {Data: []byte(`[{"name":"Dark-sight"}]`)},
	})
	if c.Gear != nil || c.Melee != nil || missing.Gear != nil || missing.Melee != nil {
		t.Error("want no gear and melee indexes")
	}
	if !reflect.DeepEqual(keys(c.Collections), keys(missing.Collections)) {
		t.Errorf("collections %q, with missing files %q", keys(c.Collections), keys(missing.Collections))
	}
	if got := c.Gear.Search("rope", 10); got != nil {
		t.Errorf("Search on a skipped index = %v", got)
	}
	if got := c.Collections["talents"].GetByName("Ambidextrous"); got != nil {
		t.Errorf("GetByName on a skipped collection = %v", got)
	}
}

func TestLoadSkipsBadEntries(t *testing.T) {
	c := loadFrom(fstest.MapFS{
		"assets/conditions.json":     {Data: []byte(`[{"name":"Prone","conditions":[]},{"name":["Stunned"]}]`)},
		"assets/psychic_powers.json": {Data: []byte(`[{"name":"Smite","experienceCost":"100"},{"name":"Fearful Aura","experienceCost":200}]`)},
		"assets/talents.json":        {Data: []byte(`[{"name":"Ambidextrous"},{"name":5},null,7,{"name":"Blind Fighting","name_ru":"Слепой бой"}]`)},
	})
	hasWarnings(t, c,
		"conditions.json: skipped entry 1: json: ",
		"psychic_powers.json: skipped entry 0: json: ",
		"talents.json: skipped entry 1: json: ",
		"talents.json: skipped entry 2: not an object: null",
		"talents.json: skipped entry 3: not an object: 7",
	)

	if c.Conditions.GetByName("Prone") == nil || len(c.Conditions.data) != 1 {
		t.Errorf("conditions %+v, want only Prone", c.Conditions.data)
	}
	if p := c.PsychicPowers.GetByName("Fearful Aura"); p == nil || *p.ExperienceCost != 200 || len(c.PsychicPowers.data) != 1 {
		t.Errorf("psychic powers %+v, want only Fearful Aura", c.PsychicPowers.data)
	}
	talents := c.Collections["talents"]
	if len(talents.data) != 2 || talents.GetByName("Ambidextrous") == nil {
		t.Errorf("talents %+v, want Ambidextrous and Blind Fighting", talents.data)
	}
	if got := talents.Search("слеп", 10); len(got) != 1 || got[0].Name != "Blind Fighting" {
		t.Errorf("Search = %+v", got)
	}
	// A skipped null must not turn into an entry with an empty name.
	if talents.GetByName("") != nil {
		t.Error("found an entry without a name")
	}
}

func keys[V any](m map[string]V) []string {
	return slices.Sorted(maps.Keys(m))
}
