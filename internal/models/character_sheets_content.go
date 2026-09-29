package models

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
)

type CharacterSheetContent struct {
	CharacterInfo    CharacterInfo             `json:"characterInfo"            validate:"required"`
	Characteristics  map[string]Characteristic `json:"characteristics"          validate:"required"`
	Conditions       Conditions                `json:"conditions"`
	SkillsLeft       map[string]Skill          `json:"skillsLeft"               validate:"required"`
	SkillsRight      map[string]Skill          `json:"skillsRight"              validate:"required"`
	CustomSkills     CustomSkills              `json:"customSkills"`
	Notes            NotesSection              `json:"notes"`
	InfamyPoints     InfamyPoints              `json:"infamyPoints"             validate:"required"`
	Fatigue          Fatigue                   `json:"fatigue"                  validate:"required"`
	ResourceTrackers ResourceTrackers          `json:"resourceTrackers"`
	Initiative       InitiativeData            `json:"initiative"`
	Size             int                       `json:"size"`
	Movement         Movement                  `json:"movement"                 validate:"required"`
	Armour           Armour                    `json:"armour"                   validate:"required"`
	PowerShields     PowerShields              `json:"powerShields"`
	RangedAttacks    RangedAttacks             `json:"rangedAttacks"`
	MeleeAttacks     MeleeAttacks              `json:"meleeAttacks"`
	Traits           Traits                    `json:"traits"`
	Talents          Talents                   `json:"talents"`
	CarryWeight      CarryWeightAndEncumbrance `json:"carryWeightAndEncumbrance" validate:"required"`
	Gear             Gear                      `json:"gear"`
	Cybernetics      Cybernetics               `json:"cybernetics"`
	Experience       Experience                `json:"experience"               validate:"required"`
	Mutations        Mutations                 `json:"mutations"`
	MentalDisorders  MentalDisorders           `json:"mentalDisorders"`
	Diseases         Diseases                  `json:"diseases"`
	Psykana          Psykana                   `json:"psykana"                  validate:"required"`
	TechnoArcana     TechnoArcana              `json:"technoArcana"`
	Settings         SheetSettings             `json:"settings"`
}

// SheetSettings are what the sheet counts for its character, the same for
// everyone who opens it.
type SheetSettings struct {
	Psykana      PsykanaSettings      `json:"psykana"`
	TechnoArcana TechnoArcanaSettings `json:"technoArcana"`
}

// TechnoArcanaSettings turn off the techno arcana rules the sheet counts, as
// PsykanaSettings do: the price an activation spends, the Processes and the
// quality of the implants a power needs.
type TechnoArcanaSettings struct {
	Price     *bool `json:"price,omitempty"`
	Processes *bool `json:"processes,omitempty"`
	Hardware  *bool `json:"hardware,omitempty"`
}

// PsykanaSettings turn off the psykana rules the sheet counts. A missing flag
// is on, as the sheet's schema has it: pointers keep it missing on the way
// through the payload.
type PsykanaSettings struct {
	Sustained *bool `json:"sustained,omitempty"`
	Cycle     *bool `json:"cycle,omitempty"`
	Phenomena *bool `json:"phenomena,omitempty"`
	// The notice of what the sheet counts was dismissed.
	NoticeSeen bool `json:"noticeSeen"`
}

type ItemGrid[T any] struct {
	Items   map[string]T        `json:"items"`
	Layouts map[string]Position `json:"layouts"`
}

type CharacterInfo struct {
	CharacterName string `json:"characterName" validate:"required"`
	Archetype     string `json:"archetype"`
	Race          string `json:"race"`
	WarbandName   string `json:"warbandName"`
	Pride         string `json:"pride"`
	Homeworld     string `json:"homeworld"`
	Origin        string `json:"origin"`
	Gender        string `json:"gender"`
	Age           string `json:"age"`
	Complexion    string `json:"complexion"`
	Disgrace      string `json:"disgrace"`
	Motivation    string `json:"motivation"`
}

type Characteristic struct {
	Value     string `json:"value"`
	Unnatural string `json:"unnatural,omitempty"`

	TempValue     string `json:"tempValue,omitempty"`
	TempUnnatural string `json:"tempUnnatural,omitempty"`
	TempEnabled   bool   `json:"tempEnabled"`
}

type ConditionEntry struct {
	Type              string `json:"type"`
	Name              string `json:"name"`
	Bonus             string `json:"bonus,omitempty"`
	UnnaturalBonus    string `json:"unnaturalBonus,omitempty"`
	OverrideValue     string `json:"overrideValue,omitempty"`
	OverrideUnnatural string `json:"overrideUnnatural,omitempty"`
	RollBonus         string `json:"rollBonus,omitempty"`
	Cap               string `json:"cap,omitempty"`
	SkillBonus        string `json:"skillBonus,omitempty"`
	AblativeWounds    string `json:"ablativeWounds,omitempty"`
	InitiativeBonus   string `json:"initiativeBonus,omitempty"`
	MovementBonus     string `json:"movementBonus,omitempty"`
	APType            string `json:"apType,omitempty"`
	APValue           string `json:"apValue,omitempty"`
	// DomainMode limits a roll_bonus entry: "only" the rolls ticked in Domains,
	// all "except" them, or all rolls when empty.
	DomainMode string      `json:"domainMode,omitempty"`
	Domains    RollDomains `json:"domains,omitzero"`
}

// RollDomains are the rolls with their own entry point on the sheet, as
// ROLL_DOMAINS in ui/static/js/sheet/schema/constants.ts lists them.
type RollDomains struct {
	Ranged       bool `json:"ranged,omitempty"`
	Melee        bool `json:"melee,omitempty"`
	Psychic      bool `json:"psychic,omitempty"`
	TechPower    bool `json:"techPower,omitempty"`
	Compensation bool `json:"compensation,omitempty"`
}

type Condition struct {
	Name    string                   `json:"name"`
	Enabled bool                     `json:"enabled"`
	Stacks  int                      `json:"stacks"`
	Entries ItemGrid[ConditionEntry] `json:"entries"`
}

type Conditions struct {
	List ItemGrid[Condition] `json:"list"`
}

type CustomSkills struct {
	List ItemGrid[Skill] `json:"list"`
}

type Skill struct {
	Name           string `json:"name,omitempty"`
	Characteristic string `json:"characteristic"`
	Plus0          bool   `json:"plus0,omitempty"`
	Plus10         bool   `json:"plus10,omitempty"`
	Plus20         bool   `json:"plus20,omitempty"`
	Plus30         bool   `json:"plus30,omitempty"`
	MiscBonus      int    `json:"miscBonus,omitempty"`
	Difficulty     int    `json:"difficulty,omitempty"`
}

type NotesSection struct {
	List ItemGrid[Note] `json:"list"`
}

type Note struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type InfamyPoints struct {
	InfamyMax  int `json:"infamyMax"`
	InfamyCur  int `json:"infamyCur"`
	InfamyTemp int `json:"infamyTemp"`
}

type Fatigue struct {
	FatigueMax  int    `json:"fatigueMax"`
	FatigueCur  int    `json:"fatigueCur"`
	FatigueMode string `json:"fatigueMode"`
}

type ResourceTrackers struct {
	List ItemGrid[ResourceTracker] `json:"list"`
}

type ResourceTracker struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
}

type InitiativeData struct {
	Dice           string `json:"dice"`
	WSBonus        bool   `json:"wsBonus"`
	BSBonus        bool   `json:"bsBonus"`
	SBonus         bool   `json:"sBonus"`
	TBonus         bool   `json:"tBonus"`
	ABonus         bool   `json:"aBonus"`
	IBonus         bool   `json:"iBonus"`
	PBonus         bool   `json:"pBonus"`
	WBonus         bool   `json:"wBonus"`
	FBonus         bool   `json:"fBonus"`
	CorBonus       bool   `json:"corBonus"`
	InfBonus       bool   `json:"infBonus"`
	FlatBonus      int    `json:"flatBonus"`
	LastInitiative int    `json:"lastInitiative"`
}

type Movement struct {
	MoveHalf   int `json:"moveHalf"`
	MoveFull   int `json:"moveFull"`
	MoveCharge int `json:"moveCharge"`
	MoveRun    int `json:"moveRun"`

	Bonus int `json:"bonus"`

	FullMult   int `json:"fullMult"`
	ChargeMult int `json:"chargeMult"`
	RunMult    int `json:"runMult"`
}

type Armour struct {
	Head                         BodyPart `json:"head"`
	LeftArm                      BodyPart `json:"leftArm"`
	Body                         BodyPart `json:"body"`
	RightArm                     BodyPart `json:"rightArm"`
	LeftLeg                      BodyPart `json:"leftLeg"`
	RightLeg                     BodyPart `json:"rightLeg"`
	WoundsMax                    int      `json:"woundsMax"`
	WoundsCur                    int      `json:"woundsCur"`
	ToughnessBaseAbsorptionValue int      `json:"toughnessBaseAbsorptionValue"`
	NaturalArmourValue           int      `json:"naturalArmourValue"`
	MachineValue                 int      `json:"machineValue"`
	DaemonicValue                int      `json:"daemonicValue"`
	OtherArmourValue             int      `json:"otherArmourValue"`
}

type BodyPart struct {
	ArmourValue int    `json:"armourValue"`
	Extra1Name  string `json:"extra1Name"`
	Extra1Value int    `json:"extra1Value"`
	Extra2Name  string `json:"extra2Name"`
	Extra2Value int    `json:"extra2Value"`
	SuperArmour int    `json:"superArmour"`
}

type PowerShields struct {
	List ItemGrid[PowerShield] `json:"list"`
}

type PowerShield struct {
	Name        string `json:"name"`
	Rating      string `json:"rating"`
	Nature      string `json:"nature"`
	Type        string `json:"type"`
	Description string `json:"description"`
}

type RangedAttacks struct {
	List ItemGrid[RangedAttack] `json:"list"`
}

type RangedAttack struct {
	Name        string              `json:"name"`
	Class       string              `json:"class"`
	Range       string              `json:"range"`
	Damage      string              `json:"damage"`
	Pen         string              `json:"pen"`
	PenMods     ItemGrid[WeaponMod] `json:"penMods"`
	DamageType  string              `json:"damageType"`
	RoFSingle   string              `json:"rofSingle"`
	RoFShort    string              `json:"rofShort"`
	RoFLong     string              `json:"rofLong"`
	ClipCur     string              `json:"clipCur"`
	ClipMax     string              `json:"clipMax"`
	Reload      string              `json:"reload"`
	Special     string              `json:"special"`
	Upgrades    string              `json:"upgrades"`
	Description string              `json:"description"`
	Roll        *RangedAttackRoll   `json:"roll,omitempty"`
	DamageMods  ItemGrid[WeaponMod] `json:"damageMods"`
}

// WeaponMod is added to the damage or penetration of a weapon or psychic
// power: an expression as ui/static/js/sheet/damage.ts parses it, e.g. "S.b",
// "½WS.b▲", "1d10", "PR", "-1".
type WeaponMod struct {
	Expr    string `json:"expr"`
	Enabled bool   `json:"enabled"`
}

type MeleeAttacks struct {
	List ItemGrid[MeleeAttack] `json:"list"`
}

type MeleeAttack struct {
	Name        string             `json:"name"`
	Group       string             `json:"group"`
	Grip        string             `json:"grip"`
	Balance     string             `json:"balance"`
	Upgrades    string             `json:"upgrades"`
	Tabs        ItemGrid[MeleeTab] `json:"tabs"`
	Description string             `json:"description"`
	Roll        *MeleeAttackRoll   `json:"roll,omitempty"`
	Shield      Shield             `json:"shield,omitempty"`
}

type MeleeTab struct {
	Profile    string              `json:"profile"`
	Range      string              `json:"range"`
	Damage     string              `json:"damage"`
	Pen        string              `json:"pen"`
	PenMods    ItemGrid[WeaponMod] `json:"penMods"`
	DamageType string              `json:"damageType"`
	Special    string              `json:"special"`
	DamageMods ItemGrid[WeaponMod] `json:"damageMods"`
}

type Shield struct {
	Subtype        string `json:"subtype"`
	AP             int    `json:"ap"`
	DefenseSectors string `json:"defenseSectors"`
	Arm            string `json:"arm"`
	Equipped       bool   `json:"equipped"`
	Defensive      bool   `json:"defensive"`
}

type AimColumn struct {
	Selected string `json:"selected"`
	No       int    `json:"no"`
	Half     int    `json:"half"`
	Full     int    `json:"full"`
}

type TargetColumn struct {
	Selected string `json:"selected"`
	No       int    `json:"no"`
	Torso    int    `json:"torso"`
	Leg      int    `json:"leg"`
	Arm      int    `json:"arm"`
	Head     int    `json:"head"`
	Joint    int    `json:"joint"`
	Eyes     int    `json:"eyes"`
}

type RangedRangeColumn struct {
	Selected   string `json:"selected"`
	Melee      int    `json:"melee"`
	PointBlank int    `json:"pointBlank"`
	Short      int    `json:"short"`
	Combat     int    `json:"combat"`
	Long       int    `json:"long"`
	Extreme    int    `json:"extreme"`
}

type RangedRoFColumn struct {
	Selected    string `json:"selected"`
	Single      int    `json:"single"`
	Short       int    `json:"short"`
	Long        int    `json:"long"`
	Suppression int    `json:"suppression"`
}

type MeleeBaseColumn struct {
	Selected string `json:"selected"`
	Standard int    `json:"standard"`
	Charge   int    `json:"charge"`
	Full     int    `json:"full"`
	Careful  int    `json:"careful"`
	Mounted  int    `json:"mounted"`
	Free     int    `json:"free"`
}

type MeleeStanceColumn struct {
	Selected   string `json:"selected"`
	Standard   int    `json:"standard"`
	Aggressive int    `json:"aggressive"`
	Defensive  int    `json:"defensive"`
}

type MeleeRoFColumn struct {
	Selected  string `json:"selected"`
	Single    int    `json:"single"`
	Quick     int    `json:"quick"`
	Lightning int    `json:"lightning"`
}

type RollExtra struct {
	Enabled bool   `json:"enabled"`
	Name    string `json:"name"`
	Value   int    `json:"value"`
}

type RangedAttackRoll struct {
	Aim        AimColumn         `json:"aim"`
	Target     TargetColumn      `json:"target"`
	Range      RangedRangeColumn `json:"range"`
	RoF        RangedRoFColumn   `json:"rof"`
	Extra1     RollExtra         `json:"extra1"`
	Extra2     RollExtra         `json:"extra2"`
	BaseSelect string            `json:"baseSelect"`
}

type MeleeAttackRoll struct {
	Aim        AimColumn         `json:"aim"`
	Target     TargetColumn      `json:"target"`
	Base       MeleeBaseColumn   `json:"base"`
	Stance     MeleeStanceColumn `json:"stance"`
	RoF        MeleeRoFColumn    `json:"rof"`
	Extra1     RollExtra         `json:"extra1"`
	Extra2     RollExtra         `json:"extra2"`
	BaseSelect string            `json:"baseSelect"`
}

type Traits struct {
	List ItemGrid[NamedDescription] `json:"list"`
}

type Talents struct {
	List ItemGrid[NamedDescription] `json:"list"`
}

type NamedDescription struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type CyberneticImplant struct {
	Name string `json:"name"`
	// Poor, Common, Good or Best: tech powers that need the implant test with it.
	Quality          string                   `json:"quality,omitempty"`
	Description      string                   `json:"description"`
	ConditionEntries ItemGrid[ConditionEntry] `json:"entries"`
}

type Cybernetics struct {
	List ItemGrid[CyberneticImplant] `json:"list"`
}

type Gear struct {
	List ItemGrid[GearItem] `json:"list"`
}

type GearItem struct {
	Name string `json:"name"`
	// Poor, Common, Good or Best, as CyberneticImplant's.
	Quality          string                   `json:"quality,omitempty"`
	Weight           float64                  `json:"weight"`
	Description      string                   `json:"description"`
	GearType         string                   `json:"gearType"`
	Carried          bool                     `json:"carried"`
	Equipped         bool                     `json:"equipped"`
	Armour           *GearArmour              `json:"armour,omitempty"`
	ConditionEntries ItemGrid[ConditionEntry] `json:"entries"`
}

type GearArmourAP struct {
	Head  string `json:"head"`
	Torso string `json:"torso"`
	Arms  string `json:"arms"`
	Legs  string `json:"legs"`
}

type GearArmour struct {
	AP             GearArmourAP `json:"ap"`
	SuperAP        GearArmourAP `json:"superAp"`
	Special        string       `json:"special"`
	Upgrades       string       `json:"upgrades"`
	AblativeWounds string       `json:"ablativeWounds"`
	StrengthBonus  string       `json:"strengthBonus"`
	AgilityBonus   string       `json:"agilityBonus"`
	MaxAgility     string       `json:"maxAgility"`
}

type CarryWeightAndEncumbrance struct {
	CarryWeightBase int     `json:"carryWeightBase"`
	Encumbrance     float64 `json:"encumbrance"`
	CarryWeight     float64 `json:"carryWeight"`
	LiftWeight      float64 `json:"liftWeight"`
	PushWeight      float64 `json:"pushWeight"`
}

type Experience struct {
	Alignment    string                   `json:"alignment"`
	Aptitudes    string                   `json:"aptitudes"`
	UseAptitudes bool                     `json:"useAptitudes"`
	UseDevotion  bool                     `json:"useDevotion"`
	Total        int                      `json:"experienceTotal"`
	Spent        int                      `json:"experienceSpent"`
	Remaining    int                      `json:"experienceRemaining"`
	Log          ItemGrid[ExperienceItem] `json:"experienceLog"`
}

type ExperienceItem struct {
	Name           string `json:"name"`
	ExperienceCost int    `json:"experienceCost"`

	Type      string `json:"type,omitempty"`
	Level     int    `json:"level,omitempty"`
	Aptitudes string `json:"aptitudes,omitempty"`
	AlliedTo  string `json:"alliedTo,omitempty"`
	HostileTo string `json:"hostileTo,omitempty"`
}

type Mutations struct {
	List ItemGrid[NamedDescription] `json:"list"`
}

type MentalDisorders struct {
	InsanityPoints int                        `json:"insanityPoints"`
	List           ItemGrid[NamedDescription] `json:"list"`
}

type Diseases struct {
	List ItemGrid[NamedDescription] `json:"list"`
}

type PsychicPowersTab struct {
	Name   string                 `json:"name"`
	Powers ItemGrid[PsychicPower] `json:"powers"`
}

type Psykana struct {
	PsykanaType     string                     `json:"psykanaType"`
	MaxPush         int                        `json:"maxPush"`
	BasePR          int                        `json:"basePR"`
	SustainedPowers int                        `json:"sustainedPowers"`
	EffectivePR     int                        `json:"effectivePR"`
	TestOptions     ItemGrid[TestOption]       `json:"testOptions"`
	Tabs            ItemGrid[PsychicPowersTab] `json:"tabs"`
	// The item id of the power cast last, whose kick the phenomena count.
	LastCastPower string `json:"lastCastPower"`
	// What sustained powers add to the phenomena; missing is the schema's 10.
	SustainPenalty *int                   `json:"sustainPenalty,omitempty"`
	PhenomenaMods  ItemGrid[PhenomenaMod] `json:"phenomenaMods"`
}

// PhenomenaMod is another modifier of the phenomena roll, e.g. of a talent.
type PhenomenaMod struct {
	Name    string `json:"name"`
	Value   int    `json:"value"`
	Enabled bool   `json:"enabled"`
}

// TestOption is what the powers of a block can be tested on: a
// characteristic ("W") or a skill ("awareness", "1_common_lore",
// "custom:<item id>"), and the characteristic the skill is tested on instead
// of its own. A power's roll refers to it by its id.
type TestOption struct {
	Base           string `json:"base"`
	Characteristic string `json:"characteristic"`
}

// Value is the option as the rolls read it: "awareness (I)".
func (o TestOption) Value() string {
	if o.Characteristic == "" {
		return o.Base
	}
	return o.Base + " (" + o.Characteristic + ")"
}

type PsychicPower struct {
	Name        string              `json:"name"`
	Subtypes    string              `json:"subtypes"`
	Range       string              `json:"range"`
	Psychotest  string              `json:"psychotest"`
	Action      string              `json:"action"`
	Sustained   string              `json:"sustained"`
	WeaponRange string              `json:"weaponRange"`
	Damage      string              `json:"damage"`
	DamageMods  ItemGrid[WeaponMod] `json:"damageMods"`
	Pen         string              `json:"pen"`
	PenMods     ItemGrid[WeaponMod] `json:"penMods"`
	DamageType  string              `json:"damageType"`
	RoFSingle   string              `json:"rofSingle"`
	RoFShort    string              `json:"rofShort"`
	RoFLong     string              `json:"rofLong"`
	Special     string              `json:"special"`
	Effect      string              `json:"effect"`
	Roll        *PsychicPowerRoll   `json:"roll,omitempty"`
	Cast        PsychicPowerCast    `json:"cast"`
	Sustain     PsychicPowerSustain `json:"sustain"`
	// A talent for this power: its casts ignore what the sustained powers
	// take from the psy rating.
	IgnoreTprPenalty bool `json:"ignoreTprPenalty"`
	// What the power adds to the phenomena of its casts.
	PhenomenaMod int `json:"phenomenaMod"`
}

type PsychicPowerRoll struct {
	// The id of the option in the block's testOptions the power is tested on.
	TestOption  string `json:"testOption"`
	Modifier    int    `json:"modifier"`
	EffectivePR int    `json:"effectivePR"`
	KickPR      int    `json:"kickPR"`
	// Manifested safely: half the current PR, no kick, no phenomena.
	Safe   bool      `json:"safe"`
	Extra1 RollExtra `json:"extra1"`
	Extra2 RollExtra `json:"extra2"`
}

// PsychicPowerSustain is how a power is sustained: none with 0 copies, more
// than one only when it is Repeatable. Free is cast free by Cycle.
type PsychicPowerSustain struct {
	Copies int  `json:"copies"`
	PR     int  `json:"pr"`
	Free   bool `json:"free"`
}

// PsychicPowerCast is the last manifestation of a power, as its roll was
// made; PR 0 is none yet. The damage and penetration count its PR.
type PsychicPowerCast struct {
	PR   int  `json:"pr"`
	Kick int  `json:"kick"`
	Safe bool `json:"safe"`
	// Why the cast calls for phenomena: "pushed", "doubles", "99", or "" for
	// none; cleared once they are rolled.
	Phenomena string `json:"phenomena"`
	// The test of the cast: its result sets Phenomena only while it is the
	// last cast of the power.
	RequestID string `json:"requestId"`
}

type TechPowersTab struct {
	Name   string              `json:"name"`
	Powers ItemGrid[TechPower] `json:"powers"`
}

type TechnoArcana struct {
	CurrentCognition int `json:"currentCognition"`
	// The maximum of cognition and energy and what each turn restores.
	CognitionMax     ResourceStat            `json:"cognitionMax"`
	CognitionRestore ResourceStat            `json:"cognitionRestore"`
	CurrentEnergy    int                     `json:"currentEnergy"`
	EnergyMax        ResourceStat            `json:"energyMax"`
	EnergyRestore    ResourceStat            `json:"energyRestore"`
	CompensationRoll CompensationRoll        `json:"compensationRoll"`
	TestOptions      ItemGrid[TestOption]    `json:"testOptions"`
	Tabs             ItemGrid[TechPowersTab] `json:"tabs"`
	// What talents and implants change in the cost of the Processes a turn.
	ProcessCost ProcessCost `json:"processCost"`
	// The energy the last activation of a Compensator power paid, which a
	// compensation roll can give back; empty once rolled or let go.
	Compensation TechCompensation `json:"compensation"`
}

// ProcessCost holds the modifiers of what the Processes cost a turn; the
// powers held in them make the rest.
type ProcessCost struct {
	Mods ItemGrid[ProcessMod] `json:"mods"`
}

// ProcessMod adds Expr of Resource, "cognition" or "energy", to the cost of
// the Processes; Name is its source, as a talent.
type ProcessMod struct {
	Name     string `json:"name"`
	Expr     string `json:"expr"`
	Resource string `json:"resource"`
	Enabled  bool   `json:"enabled"`
}

// TechCompensation is what the activation of the power with item id Power
// paid in energy: Energy from the coil and Fatigue in its place. X is the
// rating of its Compensator (X).
type TechCompensation struct {
	Power   string `json:"power"`
	X       int    `json:"x"`
	Energy  int    `json:"energy"`
	Fatigue int    `json:"fatigue"`
}

// ResourceStat is a value of cognition or energy: Base is an expression such
// as "½I.b▲", empty for the default of the rules, and the enabled Mods add to
// it.
type ResourceStat struct {
	Base string                `json:"base"`
	Mods ItemGrid[ResourceMod] `json:"mods"`
}

// ResourceMod adds Expr to a ResourceStat; Name is its source, as an implant
// or a talent.
type ResourceMod struct {
	Name    string `json:"name"`
	Expr    string `json:"expr"`
	Enabled bool   `json:"enabled"`
}

type CompensationRoll struct {
	Modifier int       `json:"modifier"`
	Extra1   RollExtra `json:"extra1"`
	Extra2   RollExtra `json:"extra2"`
}

type TechPower struct {
	Name        string              `json:"name"`
	Subtypes    string              `json:"subtypes"`
	Range       string              `json:"range"`
	Test        string              `json:"test"`
	Implants    string              `json:"implants"`
	Price       string              `json:"price"`
	Process     string              `json:"process"`
	Action      string              `json:"action"`
	WeaponRange string              `json:"weaponRange"`
	Damage      string              `json:"damage"`
	DamageMods  ItemGrid[WeaponMod] `json:"damageMods"`
	Pen         string              `json:"pen"`
	PenMods     ItemGrid[WeaponMod] `json:"penMods"`
	DamageType  string              `json:"damageType"`
	RoFSingle   string              `json:"rofSingle"`
	RoFShort    string              `json:"rofShort"`
	RoFLong     string              `json:"rofLong"`
	Special     string              `json:"special"`
	Effect      string              `json:"effect"`
	Roll        *TechPowerRoll      `json:"roll,omitempty"`
	InProcess   TechPowerInProcess  `json:"inProcess"`
	// The compilations of a Litany (X), each a Process of ½X ⚙ until used.
	Compiled int `json:"compiled"`
}

type TechPowerRoll struct {
	TestOption string `json:"testOption"`
	Modifier   int    `json:"modifier"`
	// The X of a price of X ⚙, chosen for the activation.
	X      int       `json:"x"`
	Extra1 RollExtra `json:"extra1"`
	Extra2 RollExtra `json:"extra2"`
}

// TechPowerInProcess is how many times a power is held in the Processes,
// and the X of its last activation, which a Process of X ⚙ costs.
type TechPowerInProcess struct {
	Copies int `json:"copies"`
	X      int `json:"x"`
}

type Position struct {
	ColIndex int `json:"colIndex" validate:"gte=0"`
	RowIndex int `json:"rowIndex" validate:"gte=0"`
}

func ValidateCharacterSheetJSON(jsonData json.RawMessage) error {
	var content CharacterSheetContent

	if err := json.Unmarshal(jsonData, &content); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}

	validate := validator.New()
	if err := validate.Struct(content); err != nil {
		return fmt.Errorf("validation failed: %w", err)
	}

	return nil
}

// Create object at JSON path and corresponding Layout object, set it's content if provided
// - path: container path parts (e.g. {"meleeAttack"} or {"meleeAttack","meleeAttackXYZ","tabs"})
func (m *CharacterSheetModel) CreateItem(ctx context.Context, userID, sheetID int, path []string, itemID string, pos json.RawMessage, init json.RawMessage) (int, error) {
	// Construct item path: path + itemID
	itemPath := append(append([]string(nil), path...), itemID)
	// ["customSkills", "items", "skill1"]

	layoutPath, err := replaceLastSegment(itemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid item path: %w", err)
	}
	// ["customSkills", "layouts", "skill1"]

	// Always do two jsonb_set operations (create item + set position).
	// The layouts object may be missing or null on a fresh sheet, and jsonb_set
	// only creates the last path segment, so both paths need their parents ensured.
	const q = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_ensure_path(
                jsonb_set(
                    jsonb_ensure_path(content, $1::text[]),
                    $1::text[], COALESCE($2::jsonb, '{}'::jsonb), true
                ),
                $3::text[]
            ),
            $3::text[], $4::jsonb, true
        ),
        version = version + 1,
        updated_at = now()
        WHERE id = $6 AND can_edit_character_sheet($5, $6)
        RETURNING version
    `

	var version int
	err = m.DB.QueryRow(ctx, q, itemPath, init, layoutPath, pos, userID, sheetID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

// Set a scalar value at the exact JSON path
func (m *CharacterSheetModel) ChangeField(ctx context.Context, userID, sheetID int, path []string, newValueJSON []byte) (int, error) {
	// Example path: []string{"characteristics","WS","value"}
	// Use jsonb_ensure_path to create all parent objects if they don't exist
	const stmt = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_ensure_path(content, $1::text[]),
            $1::text[], 
            $2::jsonb, 
            true
        ),
        version = version + 1,
        updated_at = now()
        WHERE id = $3
          AND can_edit_character_sheet($4, $3)
        RETURNING version
    `
	var version int
	err := m.DB.QueryRow(ctx, stmt, path, newValueJSON, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

// Merge a partial object into content at the given JSON path
func (m *CharacterSheetModel) ApplyBatch(ctx context.Context, userID, sheetID int, path []string, changes []byte) (int, error) {
	// Merge semantics: ensure path exists, then merge changes into it
	// coalesce(content #> path, '{}'::jsonb) || $2::jsonb
	const stmt = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_ensure_path(content, $1::text[]),
            $1::text[],
            coalesce(content #> $1::text[], '{}'::jsonb) || $2::jsonb,
            true
        ),
        version = version + 1,
        updated_at = now()
        WHERE id = $3
          AND can_edit_character_sheet($4, $3)
        RETURNING version
    `
	var version int
	err := m.DB.QueryRow(ctx, stmt, path, changes, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

// Update Layout position for an item (layouts.<grid>.positions.<item>)
func (m *CharacterSheetModel) ReplacePositions(ctx context.Context, userID, sheetID int, path []string, positions map[string]Position) (int, error) {
	// path is now ["customSkills", "layouts"] - already complete

	layoutPath, err := replaceLastSegment(path, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid item path: %w", err)
	}

	var valB []byte
	if positions == nil {
		valB = []byte(`{}`)
	} else {
		valB, err = json.Marshal(positions)
		if err != nil {
			return 0, err
		}
	}

	const stmt = `
        UPDATE character_sheets
        SET content = jsonb_set(
            jsonb_ensure_path(content, $1::text[]),
            $1::text[], 
			$2::jsonb, 
			true
        ),
        version = version + 1,
        updated_at = now()
        WHERE id = $3 AND can_edit_character_sheet($4, $3)
        RETURNING version
    `

	var version int
	err = m.DB.QueryRow(ctx, stmt, layoutPath, string(valB), sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

func (m *CharacterSheetModel) MoveItemBetweenGrids(
	ctx context.Context,
	userID, sheetID int,
	fromPath, toPath []string,
	itemID string,
	toPos json.RawMessage,
) (int, error) {
	// Begin transaction
	tx, err := m.DB.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Build full paths including itemID
	fromItemPath := append(append([]string(nil), fromPath...), itemID)
	toItemPath := append(append([]string(nil), toPath...), itemID)

	fromLayoutPath, err := replaceLastSegment(fromItemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid from path: %w", err)
	}

	toLayoutPath, err := replaceLastSegment(toItemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid to path: %w", err)
	}

	// Get the item content before deletion
	const getItemStmt = `
		SELECT content #> $1::text[]
		FROM character_sheets
		WHERE id = $2 AND can_edit_character_sheet($3, $2)
	`
	var itemContent json.RawMessage
	err = tx.QueryRow(ctx, getItemStmt, fromItemPath, sheetID, userID).Scan(&itemContent)
	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, fmt.Errorf("get item content: %w", err)
	}

	// Delete from source (both item and layout)
	const deleteStmt = `
		UPDATE character_sheets
		SET content = (content #- $1::text[]) #- $2::text[],
			version = version + 1,
			updated_at = now()
		WHERE id = $3 AND can_edit_character_sheet($4, $3)
		RETURNING version
	`
	var intermediateVersion int
	err = tx.QueryRow(ctx, deleteStmt, fromItemPath, fromLayoutPath, sheetID, userID).Scan(&intermediateVersion)
	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, fmt.Errorf("delete from source: %w", err)
	}

	// Create in destination (both item and layout)
	const createStmt = `
		UPDATE character_sheets
		SET content = jsonb_set(
			jsonb_ensure_path(
				jsonb_set(
					jsonb_ensure_path(content, $1::text[]),
					$1::text[], $2::jsonb, true
				),
				$3::text[]
			),
			$3::text[], $4::jsonb, true
		),
		version = version + 1,
		updated_at = now()
		WHERE id = $5 AND can_edit_character_sheet($6, $5)
		RETURNING version
	`
	var finalVersion int
	err = tx.QueryRow(ctx, createStmt, toItemPath, itemContent, toLayoutPath, toPos, sheetID, userID).Scan(&finalVersion)
	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, fmt.Errorf("create in destination: %w", err)
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit transaction: %w", err)
	}

	return finalVersion, nil
}

// Delete item at JSON path
func (m *CharacterSheetModel) DeleteItem(ctx context.Context, userID, sheetID int, path []string) (int, error) {
	itemPath := append([]string(nil), path...)

	layoutPath, err := replaceLastSegment(itemPath, "items", "layouts")
	if err != nil {
		return 0, fmt.Errorf("invalid item path: %w", err)
	}
	// layoutPath is now ["customSkills", "layouts", "skill1"]

	const query = `
        UPDATE character_sheets
        SET content = (content #- $1::text[]) #- $2::text[],
            version = version + 1,
            updated_at = now()
        WHERE id = $3 AND can_edit_character_sheet($4, $3)
        RETURNING version
    `

	var version int
	err = m.DB.QueryRow(ctx, query, itemPath, layoutPath, sheetID, userID).Scan(&version)

	if err == pgx.ErrNoRows {
		return 0, ErrPermissionDenied
	}
	if err != nil {
		return 0, err
	}
	return version, nil
}

// parseJSONBPath parses a dot-separated path into a []string for use as
// a PostgreSQL text[] parameter
func ParseJSONBPath(dotPath string) []string {
	if dotPath == "" {
		return []string{}
	}

	parts := strings.Split(dotPath, ".")

	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, p := range parts {
		if i > 0 {
			buf.WriteByte(',')
		}

		// Escape backslashes and double quotes for safe array-literal usage
		escaped := strings.ReplaceAll(p, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `"`, `\"`)

		// If element contains any characters that require quoting in PG array literal,
		// wrap it in double quotes. These include comma, braces, whitespace, backslash, quote.
		if strings.ContainsAny(escaped, ",{} \t\n\"\\") {
			buf.WriteByte('"')
			buf.WriteString(escaped)
			buf.WriteByte('"')
		} else {
			buf.WriteString(escaped)
		}
	}
	buf.WriteByte('}')

	return parts
}
