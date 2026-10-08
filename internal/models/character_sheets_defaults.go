package models

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const defaultContent = `{
  "characterInfo": {
    "characterName": "New Character"
  },
  "initiative": {
    "dice": "d10",
    "aBonus": true,
    "flatBonus": 0
  },
  "size": 0,
  "movement": { "fullMult": 2, "chargeMult": 3, "runMult": 6, "bonus": 0 }
}`

var (
	DefaultAimColumn = AimColumn{
		Selected: "no",
		No:       0,
		Half:     10,
		Full:     20,
	}

	DefaultTargetColumn = TargetColumn{
		Selected: "no",
		No:       0,
		Torso:    -10,
		Leg:      -15,
		Arm:      -20,
		Head:     -20,
		Joint:    -40,
		Eyes:     -50,
	}

	DefaultRangedRangeColumn = RangedRangeColumn{
		Selected:   "combat",
		Melee:      -20,
		PointBlank: 30,
		Short:      10,
		Combat:     0,
		Long:       -10,
		Extreme:    -30,
	}

	DefaultRangedRoFColumn = RangedRoFColumn{
		Selected:    "single",
		Single:      10,
		Short:       0,
		Long:        -10,
		Suppression: -20,
	}

	DefaultMeleeBaseColumn = MeleeBaseColumn{
		Selected: "standard",
		Standard: 10,
		Charge:   20,
		Full:     30,
		Careful:  -10,
		Mounted:  20,
		Free:     0,
	}

	DefaultMeleeStanceColumn = MeleeStanceColumn{
		Selected:   "standard",
		Standard:   0,
		Aggressive: 10,
		Defensive:  -10,
	}

	DefaultMeleeRoFColumn = MeleeRoFColumn{
		Selected:  "single",
		Single:    0,
		Quick:     -10,
		Lightning: -20,
	}

	// The client points a new attack or power at the first test option of its block.
	DefaultPsychicPowerRoll = PsychicPowerRoll{
		Modifier:    0,
		EffectivePR: 0,
		KickPR:      0,
		Extra1:      RollExtra{},
		Extra2:      RollExtra{},
	}

	DefaultTechPowerRoll = TechPowerRoll{
		Modifier: 0,
		Extra1:   RollExtra{},
		Extra2:   RollExtra{},
	}
)

func NewDefaultRangedAttackRoll() *RangedAttackRoll {
	return &RangedAttackRoll{
		Aim:    DefaultAimColumn,
		Target: DefaultTargetColumn,
		Range:  DefaultRangedRangeColumn,
		RoF:    DefaultRangedRoFColumn,
		Extra1: RollExtra{},
		Extra2: RollExtra{},
	}
}

func NewDefaultMeleeAttackRoll() *MeleeAttackRoll {
	return &MeleeAttackRoll{
		Aim:    DefaultAimColumn,
		Target: DefaultTargetColumn,
		Base:   DefaultMeleeBaseColumn,
		Stance: DefaultMeleeStanceColumn,
		RoF:    DefaultMeleeRoFColumn,
		Extra1: RollExtra{},
		Extra2: RollExtra{},
	}
}

func NewDefaultPsychicPowerRoll() *PsychicPowerRoll {
	return &DefaultPsychicPowerRoll
}

func NewDefaultTechPowerRoll() *TechPowerRoll {
	return &DefaultTechPowerRoll
}

// testOptionDefaults are the test options that the blocks of a new sheet
// start with: what the fixed base select of their attacks and powers
// offered, and Medicae for the attacks.
type testOptionDefaults struct {
	Psykana       []TestOption
	TechnoArcana  []TestOption
	RangedAttacks []TestOption
	MeleeAttacks  []TestOption
}

var blackCrusadeTestOptions = testOptionDefaults{
	Psykana: []TestOption{{Base: "W"}, {Base: "P"}, {Base: "psyniscience"}, {Base: "logic"}, {Base: "Cor"}},
	TechnoArcana: []TestOption{
		{Base: "tech-use"}, {Base: "medicae"}, {Base: "awareness", Characteristic: "I"}, {Base: "athletics"}, {Base: "logic"},
	},
	RangedAttacks: []TestOption{
		{Base: "BS"}, {Base: "I"}, {Base: "P"}, {Base: "W"}, {Base: "F"}, {Base: "acrobatics"}, {Base: "medicae", Characteristic: "BS"},
	},
	MeleeAttacks: []TestOption{
		{Base: "WS"}, {Base: "I"}, {Base: "P"}, {Base: "W"}, {Base: "F"}, {Base: "medicae", Characteristic: "WS"},
	},
}

var defaultTestOptions = map[SheetKind]testOptionDefaults{
	KindBlackCrusade:      blackCrusadeTestOptions,
	KindPathfinderCrusade: blackCrusadeTestOptions,
}

func testOptionID(i int) string {
	return fmt.Sprintf("test-option-%d", i+1)
}

func testOptionsGrid(options []TestOption) ItemGrid[TestOption] {
	grid := ItemGrid[TestOption]{Items: map[string]TestOption{}, Layouts: map[string]Position{}}
	for i, option := range options {
		grid.Items[testOptionID(i)] = option
		grid.Layouts[testOptionID(i)] = Position{ColIndex: 0, RowIndex: i}
	}
	return grid
}

// testBlock is a block with test options: its key in the content, the
// options it starts with and the rolls of its attacks or powers.
type testBlock struct {
	name    string
	options []TestOption
	rolls   func(block map[string]any) []map[string]any
}

// WithTestOptions brings the psykana and techno arcana of content without
// test options, as sheets had them before, to the current shape: they get
// the default test options of kind, and the rolls of their powers the id of
// the option their baseSelect named. The client cannot do it: an edit of one
// option would store that option alone. Migration 30 does the same in SQL.
func WithTestOptions(content json.RawMessage, kind SheetKind) (json.RawMessage, error) {
	defaults, ok := defaultTestOptions[kind]
	if !ok {
		return nil, fmt.Errorf("no default test options for sheet kind %q", kind)
	}
	return withTestBlocks(content, []testBlock{
		{"psykana", defaults.Psykana, powerRolls},
		{"technoArcana", defaults.TechnoArcana, powerRolls},
	})
}

// WithAttackTestOptions does what WithTestOptions does for the ranged and
// melee attacks. Migration 41 does the same in SQL.
func WithAttackTestOptions(content json.RawMessage, kind SheetKind) (json.RawMessage, error) {
	defaults, ok := defaultTestOptions[kind]
	if !ok {
		return nil, fmt.Errorf("no default test options for sheet kind %q", kind)
	}
	return withTestBlocks(content, []testBlock{
		{"rangedAttacks", defaults.RangedAttacks, attackRolls},
		{"meleeAttacks", defaults.MeleeAttacks, attackRolls},
	})
}

func withTestBlocks(content json.RawMessage, blocks []testBlock) (json.RawMessage, error) {
	var sheet map[string]json.RawMessage
	if err := json.Unmarshal(content, &sheet); err != nil {
		return nil, err
	}
	if sheet == nil {
		return nil, fmt.Errorf("sheet content is null")
	}

	for _, tb := range blocks {
		block := map[string]any{}
		if raw, ok := sheet[tb.name]; ok {
			// Numbers stay as written.
			dec := json.NewDecoder(bytes.NewReader(raw))
			dec.UseNumber()
			if err := dec.Decode(&block); err != nil {
				return nil, fmt.Errorf("%s: %w", tb.name, err)
			}
			if block == nil {
				block = map[string]any{}
			}
		}
		if block["testOptions"] != nil {
			continue
		}

		block["testOptions"] = testOptionsGrid(tb.options)
		pointRollsAtTestOptions(tb.rolls(block), tb.options)
		raw, err := json.Marshal(block)
		if err != nil {
			return nil, err
		}
		sheet[tb.name] = raw
	}

	return json.Marshal(sheet)
}

// oldResourceStats are the numbers techno arcana had for cognition and energy
// before ResourceStat, by the stat whose base a typed maximum becomes; what a
// turn restored has no stat and gives way to the default of the rules.
var oldResourceStats = map[string]string{"maxCognition": "cognitionMax", "maxEnergy": "energyMax", "restoreCognition": ""}

// WithResourceStats brings the techno arcana of content with those numbers to
// the current shape: a maximum other than 0 becomes the base of its stat.
// Migration 31 does the same in SQL.
func WithResourceStats(content json.RawMessage) (json.RawMessage, error) {
	var sheet map[string]json.RawMessage
	if err := json.Unmarshal(content, &sheet); err != nil {
		return nil, err
	}
	raw, ok := sheet["technoArcana"]
	if !ok {
		return content, nil
	}
	var block map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&block); err != nil {
		return nil, fmt.Errorf("technoArcana: %w", err)
	}
	changed := false
	for old, stat := range oldResourceStats {
		value, ok := block[old]
		if !ok {
			continue
		}
		delete(block, old)
		changed = true
		base := strings.TrimSpace(fmt.Sprint(value))
		if stat == "" || value == nil || base == "" || base == "0" || block[stat] != nil {
			continue
		}
		block[stat] = map[string]any{"base": base}
	}
	if !changed {
		return content, nil
	}
	encoded, err := json.Marshal(block)
	if err != nil {
		return nil, err
	}
	sheet["technoArcana"] = encoded
	return json.Marshal(sheet)
}

var leadingInt = regexp.MustCompile(`^\s*[+-]?\d+`)

// bonusOf is the bonus of the characteristic key of sheet as typed, its
// tens and its unnatural, without what conditions and talents change.
func bonusOf(sheet map[string]any, key string) int {
	char := objectAt(sheet, "characteristics", key)
	number := func(field string) int {
		n, _ := strconv.Atoi(strings.TrimSpace(leadingInt.FindString(fmt.Sprint(char[field]))))
		return n
	}
	return min(number("value"), 100)/10 + number("unnatural")
}

// WithFatigueThreshold brings the fatigue of content with a typed threshold,
// fatigueMax, to the current shape: one other than 0 and T.b+W.b becomes the
// base of the threshold; those leave it empty, to follow the rules.
// Migration 40 does the same in SQL.
func WithFatigueThreshold(content json.RawMessage) (json.RawMessage, error) {
	var sheet map[string]any
	dec := json.NewDecoder(bytes.NewReader(content))
	dec.UseNumber()
	if err := dec.Decode(&sheet); err != nil {
		return nil, err
	}
	fatigue := objectAt(sheet, "fatigue")
	value, ok := fatigue["fatigueMax"]
	if !ok {
		return content, nil
	}
	delete(fatigue, "fatigueMax")
	typed, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
	if err == nil && typed != 0 && typed != bonusOf(sheet, "T")+bonusOf(sheet, "W") && fatigue["threshold"] == nil {
		fatigue["threshold"] = map[string]any{"base": strconv.Itoa(typed)}
	}
	return json.Marshal(sheet)
}

// powerRolls are the rolls of the powers in the tabs of a psykana or techno arcana block.
func powerRolls(block map[string]any) []map[string]any {
	var rolls []map[string]any
	for _, tab := range objectAt(block, "tabs", "items") {
		for _, power := range objectAt(tab, "powers", "items") {
			if roll := objectAt(power, "roll"); roll != nil {
				rolls = append(rolls, roll)
			}
		}
	}
	return rolls
}

// attackRolls are the rolls of the attacks of a ranged or melee attacks block.
func attackRolls(block map[string]any) []map[string]any {
	var rolls []map[string]any
	for _, attack := range objectAt(block, "list", "items") {
		if roll := objectAt(attack, "roll"); roll != nil {
			rolls = append(rolls, roll)
		}
	}
	return rolls
}

// pointRollsAtTestOptions replaces the baseSelect of rolls with the id of the
// option of the same value. The fixed select showed an empty or unknown
// value as its first option.
func pointRollsAtTestOptions(rolls []map[string]any, options []TestOption) {
	for _, roll := range rolls {
		base, _ := roll["baseSelect"].(string)
		roll["testOption"] = testOptionID(0)
		for i, option := range options {
			if option.Value() == base {
				roll["testOption"] = testOptionID(i)
				break
			}
		}
		delete(roll, "baseSelect")
	}
}

// objectAt is the object at keys under v, nil when something on the way is not an object.
func objectAt(v any, keys ...string) map[string]any {
	for _, key := range keys {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[key]
	}
	m, _ := v.(map[string]any)
	return m
}
