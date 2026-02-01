package models

const defaultContent = `{
  "character-info": {
    "character-name": "New Character"
  },
  "characteristics": {},
  "skills-left": {},
  "skills-right": {},
  "custom-skills": {},
  "notes": {},
  "infamy-points": {},
  "fatigue": {},
  "initiative": "d10+0",
  "size": 0,
  "movement": {},
  "armour": {},
  "ranged-attack": {},
  "melee-attack": {},
  "traits": {},
  "talents": {},
  "carry-weight-and-encumbrance": {},
  "gear": {},
  "cybernetics": {},
  "experience": {
  	"experience-log": {}
  },
  "mutations": {},
  "mental-disorders": {},
  "diseases": {},
  "psykana": {
	"tabs": {}
  },
  "techno-arcana": {
	"tabs": {}
  }
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
		Single:      0,
		Short:       10,
		Long:        20,
		Suppression: -20,
	}

	DefaultMeleeBaseColumn = MeleeBaseColumn{
		Selected: "standard",
		Standard: 0,
		Charge:   10,
		Full:     -10,
		Careful:  10,
		Mounted:  20,
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

	DefaultRangedAttackRoll = RangedAttackRoll{
		Aim:    DefaultAimColumn,
		Target: DefaultTargetColumn,
		Range:  DefaultRangedRangeColumn,
		RoF:    DefaultRangedRoFColumn,
		Extra1: RollExtra{},
		Extra2: RollExtra{},
	}

	DefaultMeleeAttackRoll = MeleeAttackRoll{
		Aim:    DefaultAimColumn,
		Target: DefaultTargetColumn,
		Base:   DefaultMeleeBaseColumn,
		Stance: DefaultMeleeStanceColumn,
		RoF:    DefaultMeleeRoFColumn,
		Extra1: RollExtra{},
		Extra2: RollExtra{},
	}
)

func NewDefaultRangedAttackRoll() *RangedAttackRoll {
	return &RangedAttackRoll{
		Aim:        DefaultAimColumn,
		Target:     DefaultTargetColumn,
		Range:      DefaultRangedRangeColumn,
		RoF:        DefaultRangedRoFColumn,
		Extra1:     RollExtra{},
		Extra2:     RollExtra{},
		BaseSelect: "BS",
	}
}

func NewDefaultMeleeAttackRoll() *MeleeAttackRoll {
	return &MeleeAttackRoll{
		Aim:        DefaultAimColumn,
		Target:     DefaultTargetColumn,
		Base:       DefaultMeleeBaseColumn,
		Stance:     DefaultMeleeStanceColumn,
		RoF:        DefaultMeleeRoFColumn,
		Extra1:     RollExtra{},
		Extra2:     RollExtra{},
		BaseSelect: "WS",
	}
}
