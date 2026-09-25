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

export interface BodyPart {
    readonly key: string;
    readonly label: string;
    /** Hit location roll range. */
    readonly hits: string;
}

export const BODY_PARTS: readonly BodyPart[] = [
    { key: "head", label: "Head", hits: "1-10" },
    { key: "leftArm", label: "Left Arm", hits: "11-20" },
    { key: "body", label: "Body", hits: "31-70" },
    { key: "rightArm", label: "Right Arm", hits: "21-30" },
    { key: "leftLeg", label: "Left Leg", hits: "71-85" },
    { key: "rightLeg", label: "Right Leg", hits: "86-00" },
];

/** Characteristics whose bonus can be added to initiative, and the checkbox of each. */
export const INITIATIVE_BONUSES: readonly { readonly characteristic: string; readonly field: string }[] = [
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
];

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

/** What a level means for each advancement type whose cost is computed. */
export const EXPERIENCE_LEVELS_BY_TYPE: { readonly [type: string]: readonly Option[] } = {
    talent: ["1", "2", "3"],
    skill: [
        { value: "1", label: "− → +0" },
        { value: "2", label: "+0 → +10" },
        { value: "3", label: "+10 → +20" },
        { value: "4", label: "+20 → +30" },
    ],
    characteristic: [
        { value: "1", label: "+0 → +5" },
        { value: "2", label: "+5 → +10" },
        { value: "3", label: "+10 → +15" },
        { value: "4", label: "+15 → +20" },
        { value: "5", label: "+20 → +25" },
    ],
};

/** The levels of every type are a prefix of the characteristic ones. */
export const EXPERIENCE_LEVELS: readonly string[] = optionValues(EXPERIENCE_LEVELS_BY_TYPE.characteristic);

export const RANGED_BASE_SELECTS: readonly Option[] = ["BS", "I", "P", "W", "F", ...capitalized(["acrobatics"])];

export const MELEE_BASE_SELECTS: readonly Option[] = ["WS", "I", "P", "W", "F"];

export const PSYCHIC_BASE_SELECTS: readonly Option[] = ["W", "P", ...capitalized(["psyniscience", "logic"]), "Cor"];

export const TECH_BASE_SELECTS: readonly Option[] = [
    { value: "tech-use", label: "Tech-Use" },
    ...capitalized(["medicae"]),
    { value: "awareness (I)", label: "Awareness (I)" },
    ...capitalized(["athletics", "logic"]),
];

// ─── Roll radio groups ───────────────────────────────────────────────────────

/** The field of a roll column that holds an option's modifier: "point-blank" is "pointBlank". */
export const modifierField = (value: string): string => value.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

export const AIM_OPTIONS: readonly Option[] = capitalized(["no", "half", "full"]);

export const TARGET_OPTIONS: readonly Option[] = capitalized(["no", "torso", "leg", "arm", "head", "joint", "eyes"]);

export const RANGED_RANGE_OPTIONS: readonly Option[] = capitalized(["melee", "point-blank", "short", "combat", "long", "extreme"]);

export const RANGED_ROF_OPTIONS: readonly Option[] = capitalized(["single", "short", "long", "suppression"]);

export const MELEE_BASE_OPTIONS: readonly Option[] = capitalized(["standard", "charge", "full", "careful", "mounted", "free"]);

export const MELEE_STANCE_OPTIONS: readonly Option[] = capitalized(["standard", "aggressive", "defensive"]);

export const MELEE_ROF_OPTIONS: readonly Option[] = capitalized(["single", "quick", "lightning"]);
