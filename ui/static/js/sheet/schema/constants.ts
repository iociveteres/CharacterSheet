// Fixed lists of the sheet: characteristics, skills, body parts and the
// options of every select and radio group. The schema takes the allowed
// values from them, the blocks render their labels.

/** An option of a select or radio group: its value, which is also its label, or both. */
export type Option = string | { readonly value: string; readonly label: string };

export const optionValue = (o: Option): string => (typeof o === "string" ? o : o.value);
export const optionLabel = (o: Option): string => (typeof o === "string" ? o : o.label);
export const optionValues = (options: readonly Option[]): string[] => options.map(optionValue);

/** Options labelled by their value with the first letter up, e.g. "pistol" as "Pistol". */
const capitalized = (values: readonly string[]): Option[] =>
    values.map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));

export interface Characteristic {
    readonly key: string;
    readonly label: string;
}

export const CHARACTERISTICS: readonly Characteristic[] = [
    { key: "WS", label: "Weapon Skill" },
    { key: "BS", label: "Ballistic Skill" },
    { key: "S", label: "Strength" },
    { key: "T", label: "Toughness" },
    { key: "A", label: "Agility" },
    { key: "I", label: "Intellig." },
    { key: "P", label: "Perception" },
    { key: "W", label: "Willpower" },
    { key: "F", label: "Fellowship" },
    { key: "Inf", label: "Infamy" },
    { key: "Cor", label: "Corruption" },
];

export const CHARACTERISTIC_KEYS: readonly string[] = CHARACTERISTICS.map(c => c.key);

/** What a skill row can be tested on, in the order the skill table has always listed them. */
export const SKILL_CHARACTERISTICS: readonly string[] = ["WS", "BS", "S", "T", "A", "P", "I", "W", "F", "Inf", "Cor"];

export interface SkillRow {
    readonly key: string;
    readonly label: string;
    /** Characteristic shown when the stored one is empty. */
    readonly def: string;
    /** Heading of the group the row is listed under, e.g. "Navigate". */
    readonly group?: string;
}

/** Skills of the left column, 3_skills_left.html. Names are fixed. */
export const SKILLS_LEFT: readonly SkillRow[] = [
    { key: "acrobatics", label: "Acrobatics", def: "A" },
    { key: "athletics", label: "Athletics", def: "S" },
    { key: "awareness", label: "Awareness", def: "P" },
    { key: "charm", label: "Charm", def: "F" },
    { key: "command", label: "Command", def: "F" },
    { key: "commerce", label: "Commerce", def: "I" },
    { key: "deceive", label: "Deceive", def: "I" },
    { key: "dodge", label: "Dodge", def: "A" },
    { key: "inquiry", label: "Inquiry", def: "F" },
    { key: "interrogation", label: "Interrogation", def: "W" },
    { key: "intimidate", label: "Intimidate", def: "W" },
    { key: "logic", label: "Logic", def: "I" },
    { key: "medicae", label: "Medicae", def: "I" },
    { key: "navigate_surface", label: "Surface", def: "I", group: "Navigate" },
    { key: "navigate_stellar", label: "Stellar", def: "I", group: "Navigate" },
    { key: "navigate_warp", label: "Warp", def: "I", group: "Navigate" },
    { key: "operate_surface", label: "Surface", def: "A", group: "Operate" },
    { key: "operate_aeronautica", label: "Aeronautica", def: "A", group: "Operate" },
    { key: "operate_void", label: "Void", def: "I", group: "Operate" },
    { key: "parry", label: "Parry", def: "WS" },
    { key: "psyniscience", label: "Psyniscience", def: "P" },
    { key: "scrutiny", label: "Scrutiny", def: "P" },
    { key: "security", label: "Security", def: "I" },
    { key: "sleight_of_hand", label: "Sleight of Hand", def: "A" },
    { key: "stealth", label: "Stealth", def: "A" },
    { key: "survival", label: "Survival", def: "P" },
    { key: "tech-use", label: "Tech-Use", def: "I" },
];

const numberedSkills = (group: string, suffix: string, count: number): SkillRow[] =>
    Array.from({ length: count }, (_, i) => ({ key: `${i + 1}_${suffix}`, label: "", def: "I", group }));

/** Skills of the right column, 4_skills_right.html. Names are editable. */
export const SKILLS_RIGHT: readonly SkillRow[] = [
    ...numberedSkills("Linguistics", "linguistics", 5),
    ...numberedSkills("Trade", "trade", 5),
    ...numberedSkills("Common Lore", "common_lore", 6),
    ...numberedSkills("Scholastic Lore", "scholastic_lore", 5),
    ...numberedSkills("Forbidden Lore", "forbidden_lore", 5),
];

/** The characteristics and skills of a sheet kind, as lists of them (e.g. test options) offer them. */
export interface StatSet {
    readonly characteristics: readonly Characteristic[];
    /** What a skill can be tested on. */
    readonly skillCharacteristics: readonly string[];
    readonly skillsLeft: readonly SkillRow[];
    readonly skillsRight: readonly SkillRow[];
}

export const BLACK_CRUSADE_STATS: StatSet = {
    characteristics: CHARACTERISTICS,
    skillCharacteristics: SKILL_CHARACTERISTICS,
    skillsLeft: SKILLS_LEFT,
    skillsRight: SKILLS_RIGHT,
};

export interface BodyPart {
    readonly key: string;
    readonly label: string;
    /** Hit location roll range. */
    readonly hits: string;
}

// Literal keys, so the armour group of the schema types each part.
export const BODY_PARTS = [
    { key: "head", label: "Head", hits: "1-10" },
    { key: "leftArm", label: "Left Arm", hits: "11-20" },
    { key: "body", label: "Body", hits: "31-70" },
    { key: "rightArm", label: "Right Arm", hits: "21-30" },
    { key: "leftLeg", label: "Left Leg", hits: "71-85" },
    { key: "rightLeg", label: "Right Leg", hits: "86-00" },
] as const satisfies readonly BodyPart[];

export type BodyPartKey = (typeof BODY_PARTS)[number]["key"];

/** Characteristics whose bonus can be added to initiative, and the checkbox of each. */
export const INITIATIVE_BONUSES = [
    { characteristic: "WS", field: "wsBonus" },
    { characteristic: "BS", field: "bsBonus" },
    { characteristic: "S", field: "sBonus" },
    { characteristic: "T", field: "tBonus" },
    { characteristic: "A", field: "aBonus" },
    { characteristic: "I", field: "iBonus" },
    { characteristic: "P", field: "pBonus" },
    { characteristic: "W", field: "wBonus" },
    { characteristic: "F", field: "fBonus" },
    { characteristic: "Cor", field: "corBonus" },
    { characteristic: "Inf", field: "infBonus" },
] as const satisfies readonly { readonly characteristic: string; readonly field: string }[];

// ─── Select options ──────────────────────────────────────────────────────────

export const SIZE_OPTIONS: readonly Option[] = [
    { value: "-3", label: "Miniscule (-3)" },
    { value: "-2", label: "Puny (-2)" },
    { value: "-1", label: "Weedy (-1)" },
    { value: "0", label: "Average (0)" },
    { value: "1", label: "Hulking (1)" },
    { value: "2", label: "Enormous (2)" },
    { value: "3", label: "Massive (3)" },
    { value: "4", label: "Immense (4)" },
    { value: "5", label: "Monumental (5)" },
    { value: "6", label: "Titanic (6)" },
];

export const FATIGUE_MODES: readonly Option[] = capitalized(["all", "mental", "physical", "nothing"]);

/** The paths of each god; an alignment is "Undivided" or "God (Path)". */
export const ALIGNMENT_PATHS: readonly (readonly [string, readonly string[]])[] = [
    ["Khorne", ["Vanguard", "Berserker", "Smith"]],
    ["Slaanesh", ["Bladedancer", "Intriguer", "Hedonist"]],
    ["Nurgle", ["Meister", "Undying", "Cultist"]],
    ["Tzeentch", ["Sniper", "Warlock", "Sage"]],
];

export const ALIGNMENTS: readonly string[] = [
    "Undivided",
    ...ALIGNMENT_PATHS.flatMap(([god, paths]) => paths.map(path => `${god} (${path})`)),
];

export const PSYKANA_TYPES: readonly Option[] = ["Bound", "Unbound", "Daemonic"];

export const ENTRY_TYPES: readonly Option[] = [
    { value: "char_bonus", label: "Char. Bonus" },
    { value: "char_cap", label: "Char. Cap" },
    { value: "char_override", label: "Char. Override" },
    { value: "roll_bonus", label: "Roll Bonus" },
    { value: "skill_bonus", label: "Skill Bonus" },
    { value: "ablative_wounds", label: "Ab. Wounds" },
    { value: "initiative_bonus", label: "Init. Bonus" },
    { value: "movement_bonus", label: "Move. Bonus" },
    { value: "bonus_ap", label: "Bonus AP" },
];

/**
 * Rolls a roll_bonus entry can be limited to: each has its own Roll button on
 * the sheet (blocks/rollParts.tsx). A characteristic button and a skill roll
 * are ordinary tests, of no domain.
 */
export const ROLL_DOMAINS = [
    { value: "ranged", label: "Ranged", title: "Applies to ranged attack rolls" },
    { value: "melee", label: "Melee", title: "Applies to melee attack rolls" },
    { value: "psychic", label: "Psy", title: "Applies to psychotests" },
    { value: "techPower", label: "Tech", title: "Applies to tech power tests" },
    { value: "compensation", label: "Comp", title: "Applies to compensation tests of tech powers" },
] as const satisfies readonly { value: string; label: string; title: string }[];

export type RollDomain = (typeof ROLL_DOMAINS)[number]["value"];

/** What the mode select of a roll bonus explains on hover. */
export const ROLL_DOMAIN_MODES_TITLE =
    "Which rolls the bonus counts in.\n" +
    "All rolls: every test on the characteristics.\n" +
    "Only: just the ticked rolls on them; Any counts whatever the roll is tested on.\n" +
    "Except: every test on them but the ticked rolls.\n" +
    "A characteristic or skill test is none of the ticked rolls.";

export const ROLL_DOMAIN_MODES: readonly Option[] = [
    { value: "", label: "All rolls" },
    { value: "only", label: "Only" },
    { value: "except", label: "Except" },
];

export const AP_TYPES: readonly Option[] = capitalized(["natural", "daemonic", "machine", "other"]);

export const DAMAGE_TYPES: readonly Option[] = ["I", "I(Cr)", "R", "X", "X(Fr)", "E", "E(El)", "E(Ls)", "E(Fl)", "C", "C(Tx)"];

export const RANGED_CLASSES: readonly Option[] = [
    ...capitalized(["pistol", "rifle"]),
    { value: "long rifle", label: "Long Rifle" },
    ...capitalized(["heavy", "throwing", "grenade", "special"]),
];

export const MELEE_GROUPS: readonly Option[] = [
    ...capitalized(["primary"]),
    { value: "primary (shield)", label: "Primary (Shield)" },
    ...capitalized(["chain", "shock", "power", "exotic", "mechadendrite"]),
];

/** A profile's label capitalizes each part: "claws.h" is "Claws.H". */
export const MELEE_PROFILES: readonly Option[] = [
    ...["mace", "glaive", "flail", "whip", "claws", "claws.h", "claws.a", "spear", "hook", "fist",
        "fist.a", "sword", "rapier", "saber", "hammer", "axe", "knife", "staff", "bayonet", "shield",
        "bite", "no"]
        .map(value => ({ value, label: value.replace(/(^|\.)([a-z])/g, (_, dot: string, c: string) => dot + c.toUpperCase()) })),
    { value: "", label: "Other" },
];

export const SHIELD_SUBTYPES: readonly Option[] = [
    ...capitalized(["buckler", "targ", "ecu", "round", "teardrop"]),
    { value: "light tower", label: "Light Tower" },
    ...capitalized(["tower"]),
];

export const SHIELD_ARMS: readonly Option[] = capitalized(["left", "right"]);

export const POWER_SHIELD_NATURES: readonly Option[] = capitalized(["tech", "arcane"]);

export const POWER_SHIELD_TYPES: readonly Option[] = capitalized(["dome", "phase", "deflector"]);

export const GEAR_TYPES: readonly Option[] = [
    ...capitalized(["gear", "tool", "armour", "weapon", "consumable", "mount"]),
    { value: "", label: "Other" },
];

export const EXPERIENCE_TYPES: readonly Option[] = [
    ...capitalized(["other", "characteristic", "skill", "talent"]),
    { value: "eliteArchetype", label: "Elite Archetype" },
    { value: "psychicPower", label: "Psychic Power" },
    { value: "techPower", label: "Tech Power" },
];

/** A level of an advancement and its cost with 0, 1 and 2 matching aptitudes. */
export interface ExperienceLevel {
    readonly value: string;
    readonly label: string;
    readonly cost: readonly [number, number, number];
}

/** The levels of each advancement type whose cost is computed, as in the Black Crusade tables. */
export const EXPERIENCE_LEVELS_BY_TYPE: { readonly [type: string]: readonly ExperienceLevel[] } = {
    talent: [
        { value: "1", label: "1", cost: [400, 250, 150] },
        { value: "2", label: "2", cost: [750, 500, 300] },
        { value: "3", label: "3", cost: [1000, 750, 400] },
    ],
    skill: [
        { value: "1", label: "− → +0", cost: [300, 200, 100] },
        { value: "2", label: "+0 → +10", cost: [500, 350, 200] },
        { value: "3", label: "+10 → +20", cost: [700, 500, 350] },
        { value: "4", label: "+20 → +30", cost: [900, 750, 550] },
    ],
    characteristic: [
        { value: "1", label: "+0 → +5", cost: [500, 250, 100] },
        { value: "2", label: "+5 → +10", cost: [750, 500, 250] },
        { value: "3", label: "+10 → +15", cost: [1000, 750, 500] },
        { value: "4", label: "+15 → +20", cost: [1500, 1000, 750] },
        { value: "5", label: "+20 → +25", cost: [2500, 1500, 1000] },
    ],
};

/** The levels of every type are a prefix of the characteristic ones. */
export const EXPERIENCE_LEVELS: readonly string[] = optionValues(EXPERIENCE_LEVELS_BY_TYPE.characteristic);

export const RANGED_BASE_SELECTS: readonly Option[] = ["BS", "I", "P", "W", "F", ...capitalized(["acrobatics"])];

export const MELEE_BASE_SELECTS: readonly Option[] = ["WS", "I", "P", "W", "F"];

// ─── Roll columns ────────────────────────────────────────────────────────────

/** A column of an attack's roll dropdown, such as aim or range. */
export interface RollColumn<K extends string = string> {
    /** The column's key in the roll. */
    readonly key: K;
    readonly label: string;
    readonly options: readonly Option[];
    /** The option that counts when none is selected; the roll label leaves it out. */
    readonly default: string;
    /** How the roll label names an option, when not by its value. */
    readonly names?: { readonly [value: string]: string };
}

/** The field of a roll column that holds an option's modifier: "point-blank" is "pointBlank". */
export const modifierField = (value: string): string => value.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** Keeps a column's key as a literal type, so the schema types each column of a roll. */
const column = <K extends string>(c: RollColumn<K>) => c;

const AIM = column({
    key: "aim", label: "Aim", options: capitalized(["no", "half", "full"]), default: "no",
    names: { half: "half aim", full: "full aim" },
});

const TARGET = column({
    key: "target", label: "Target", options: capitalized(["no", "torso", "leg", "arm", "head", "joint", "eyes"]), default: "no",
});

export const RANGED_ROLL_COLUMNS = [
    AIM,
    TARGET,
    column({ key: "range", label: "Range", options: capitalized(["melee", "point-blank", "short", "combat", "long", "extreme"]), default: "combat" }),
    column({
        key: "rof", label: "RoF", options: capitalized(["single", "short", "long", "suppression"]), default: "single",
        names: { short: "short burst", long: "long burst" },
    }),
] as const;

export const MELEE_ROLL_COLUMNS = [
    AIM,
    TARGET,
    column({
        key: "base", label: "Base", options: capitalized(["standard", "charge", "full", "careful", "mounted", "free"]), default: "standard",
        names: { full: "full attack" },
    }),
    column({ key: "stance", label: "Stance", options: capitalized(["standard", "aggressive", "defensive"]), default: "standard" }),
    column({
        key: "rof", label: "RoF", options: capitalized(["single", "quick", "lightning"]), default: "single",
        names: { quick: "quick attack", lightning: "lightning attack" },
    }),
] as const;
