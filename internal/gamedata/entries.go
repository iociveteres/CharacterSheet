package gamedata

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"charactersheet.iociveteres.net/internal/models"
)

// assetString is a string field of an asset entry that also takes a number or
// null, so one unquoted value in the assets does not drop its entry.
type assetString string

func (s *assetString) UnmarshalJSON(b []byte) error {
	if bytes.Equal(b, []byte("null")) {
		*s = ""
		return nil
	}
	var str string
	if err := json.Unmarshal(b, &str); err == nil {
		*s = assetString(str)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err != nil {
		return fmt.Errorf("want a string or a number, got %s", b)
	}
	*s = assetString(n.String())
	return nil
}

// assetConditionEntry is one element of the "conditions" array of
// gear.json, cybernetics.json and conditions.json.
type assetConditionEntry struct {
	Type      string      `json:"type"`
	Name      assetString `json:"name"`
	Value     assetString `json:"value"`
	Unnatural assetString `json:"unnatural"`
	APType    assetString `json:"apType"`
	// Only and Except limit a RollBonus to some rolls, by the keys of rollDomain.
	Only   []string `json:"only"`
	Except []string `json:"except"`
}

// toConditionEntry maps an asset entry to the sheet's entry, the shape that
// ui/static/js/sheet/blocks/ConditionEntries.tsx edits and state/computed.ts
// reads. It fails for a type the sheet has no entry for.
func toConditionEntry(a assetConditionEntry) (e models.ConditionEntry, err error) {
	name, value := string(a.Name), string(a.Value)
	switch a.Type {
	case "CharacteristicBonus":
		e = models.ConditionEntry{Type: "char_bonus", Name: name, Bonus: value, UnnaturalBonus: string(a.Unnatural)}
	case "CharacteristicCap":
		e = models.ConditionEntry{Type: "char_cap", Name: name, Cap: value}
	case "CharacteristicOverride":
		e = models.ConditionEntry{Type: "char_override", Name: name, OverrideValue: value, OverrideUnnatural: string(a.Unnatural)}
	case "RollBonus":
		e = models.ConditionEntry{Type: "roll_bonus", Name: name, RollBonus: value}
		if e.DomainMode, e.Domains, err = rollDomains(a.Only, a.Except); err != nil {
			return models.ConditionEntry{}, err
		}
		// The assets leave out the name of a bonus to rolls of a domain on any
		// characteristic; on the sheet an empty name counts nowhere.
		if e.DomainMode != "" && strings.TrimSpace(e.Name) == "" {
			e.Name = "Any"
		}
	case "SkillBonus":
		e = models.ConditionEntry{Type: "skill_bonus", Name: name, SkillBonus: value}
	case "AblativeWounds":
		e = models.ConditionEntry{Type: "ablative_wounds", AblativeWounds: value}
	case "InitiativeBonus":
		e = models.ConditionEntry{Type: "initiative_bonus", InitiativeBonus: value}
	case "MovementBonus":
		e = models.ConditionEntry{Type: "movement_bonus", MovementBonus: value}
	case "BonusAP":
		// The sheet's AP types are lowercase and state/armour.ts compares them as is.
		e = models.ConditionEntry{Type: "bonus_ap", APType: strings.ToLower(string(a.APType)), APValue: value}
	default:
		return models.ConditionEntry{}, fmt.Errorf("unknown type %q", a.Type)
	}
	return e, nil
}

// rollDomains converts the only or except list of a RollBonus to the sheet's
// domain mode and ticked domains. An unknown domain fails the entry: without
// it an "only" bonus would count in every roll.
func rollDomains(only, except []string) (mode string, d models.RollDomains, err error) {
	var list []string
	switch {
	case len(only) > 0 && len(except) > 0:
		return "", d, fmt.Errorf("both only and except")
	case len(only) > 0:
		mode, list = "only", only
	case len(except) > 0:
		mode, list = "except", except
	default:
		return "", d, nil
	}
	for _, name := range list {
		p := rollDomain(&d, name)
		if p == nil {
			return "", models.RollDomains{}, fmt.Errorf("unknown roll domain %q", name)
		}
		*p = true
	}
	return mode, d, nil
}

// rollDomain is the field of d for a domain as the assets name it, nil for an
// unknown one.
func rollDomain(d *models.RollDomains, name string) *bool {
	switch name {
	case "ranged":
		return &d.Ranged
	case "melee":
		return &d.Melee
	case "psychic":
		return &d.Psychic
	case "techPower":
		return &d.TechPower
	case "compensation":
		return &d.Compensation
	}
	return nil
}

// assetConditions is the "conditions" array of an asset entry, converted once
// at load time. Entries that can't be converted are left out and described in
// skipped, for Load to log.
type assetConditions struct {
	entries []models.ConditionEntry
	skipped []string
}

// conditionsFromRaw converts the "conditions" field of the asset entry raw.
// A missing field, null or {} (older assets write that for "none") is empty.
func conditionsFromRaw(raw json.RawMessage) assetConditions {
	var c assetConditions
	var fields struct {
		Conditions json.RawMessage `json:"conditions"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return c
	}
	field := bytes.TrimSpace(fields.Conditions)
	if len(field) == 0 || bytes.Equal(field, []byte("null")) || bytes.Equal(field, []byte("{}")) {
		return c
	}
	var elems []json.RawMessage
	if err := json.Unmarshal(field, &elems); err != nil {
		c.skipped = append(c.skipped, fmt.Sprintf("conditions is not an array: %.80s", field))
		return c
	}
	for i, elem := range elems {
		var a assetConditionEntry
		if err := json.Unmarshal(elem, &a); err != nil {
			c.skipped = append(c.skipped, fmt.Sprintf("entry %d: %v", i, err))
			continue
		}
		e, err := toConditionEntry(a)
		if err != nil {
			c.skipped = append(c.skipped, fmt.Sprintf("entry %d: %v", i, err))
			continue
		}
		c.entries = append(c.entries, e)
	}
	return c
}

// grid returns the entries as an ItemGrid in one column. Ids are new on every
// call: each apply creates new entries.
func (c assetConditions) grid() models.ItemGrid[models.ConditionEntry] {
	g := models.ItemGrid[models.ConditionEntry]{
		Items:   make(map[string]models.ConditionEntry, len(c.entries)),
		Layouts: make(map[string]models.Position, len(c.entries)),
	}
	for i, e := range c.entries {
		id := "cond-" + newNanoid()
		g.Items[id] = e
		g.Layouts[id] = models.Position{ColIndex: 0, RowIndex: i}
	}
	return g
}

// withEntries returns the asset entry raw with its "conditions" replaced by
// an "entries" grid of conds and the fields of set written over it. The other
// fields pass through.
func withEntries(raw json.RawMessage, conds assetConditions, set map[string]json.RawMessage) json.RawMessage {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw
	}
	delete(m, "conditions")
	entries, err := json.Marshal(conds.grid())
	if err != nil {
		return raw
	}
	m["entries"] = entries
	for k, v := range set {
		m[k] = v
	}
	out, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return out
}

// conditionHolder is an index entry with a converted "conditions" array.
type conditionHolder interface {
	indexable
	entryName() string
	skippedConditions() []string
}

// conditionWarnings describes the skipped condition entries of idx, one line
// per entry, prefixed with the asset path and the entry name.
func conditionWarnings[T any, PT interface {
	*T
	conditionHolder
}](path string, idx *Index[T, PT]) []string {
	if idx == nil {
		return nil
	}
	var out []string
	for i := range idx.data {
		p := PT(&idx.data[i])
		for _, s := range p.skippedConditions() {
			out = append(out, fmt.Sprintf("%s: %s: skipped condition %s", path, p.entryName(), s))
		}
	}
	return out
}
