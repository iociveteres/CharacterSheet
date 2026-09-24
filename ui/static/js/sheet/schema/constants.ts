// Fixed lists the sheet templates spell out: characteristics, skills, body
// parts and the options of every select.

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
    { key: "I", label: "Intelligence" },
    { key: "P", label: "Perception" },
    { key: "W", label: "Willpower" },
    { key: "F", label: "Fellowship" },
    { key: "Inf", label: "Infamy" },
    { key: "Cor", label: "Corruption" },
];

export const CHARACTERISTIC_KEYS: readonly string[] = CHARACTERISTICS.map(c => c.key);

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

/** Characteristics whose bonus can be added to initiative. */
export const INITIATIVE_BONUSES = [
    "wsBonus", "bsBonus", "sBonus", "tBonus", "aBonus", "iBonus",
    "pBonus", "wBonus", "fBonus", "corBonus", "infBonus",
] as const;

// ─── Select options ──────────────────────────────────────────────────────────

export const SIZE_OPTIONS = ["-3", "-2", "-1", "0", "1", "2", "3", "4", "5", "6"] as const;

export const FATIGUE_MODES = ["all", "mental", "physical", "nothing"] as const;

export const ALIGNMENTS = [
    "Undivided",
    "Khorne (Vanguard)", "Khorne (Berserker)", "Khorne (Smith)",
    "Slaanesh (Bladedancer)", "Slaanesh (Intriguer)", "Slaanesh (Hedonist)",
    "Nurgle (Meister)", "Nurgle (Undying)", "Nurgle (Cultist)",
    "Tzeentch (Sniper)", "Tzeentch (Warlock)", "Tzeentch (Sage)",
] as const;

export const PSYKANA_TYPES = ["Bound", "Unbound", "Daemonic"] as const;

export const ENTRY_TYPES = [
    "char_bonus", "char_cap", "char_override", "roll_bonus", "skill_bonus",
    "ablative_wounds", "initiative_bonus", "movement_bonus", "bonus_ap",
] as const;

export const AP_TYPES = ["natural", "daemonic", "machine", "other"] as const;

export const DAMAGE_TYPES = ["I", "I(Cr)", "R", "X", "X(Fr)", "E", "E(El)", "E(Ls)", "E(Fl)", "C", "C(Tx)"] as const;

export const RANGED_CLASSES = ["pistol", "rifle", "long rifle", "heavy", "throwing", "grenade", "special"] as const;

export const MELEE_GROUPS = [
    "primary", "primary (shield)", "chain", "shock", "power", "exotic", "mechadendrite",
] as const;

/** "" is "Other". */
export const MELEE_PROFILES = [
    "mace", "glaive", "flail", "whip", "claws", "claws.h", "claws.a", "spear", "hook", "fist",
    "fist.a", "sword", "rapier", "saber", "hammer", "axe", "knife", "staff", "bayonet", "shield",
    "bite", "no", "",
] as const;

export const SHIELD_SUBTYPES = ["buckler", "targ", "ecu", "round", "teardrop", "light tower", "tower"] as const;

export const SHIELD_ARMS = ["left", "right"] as const;

export const POWER_SHIELD_NATURES = ["tech", "arcane"] as const;

export const POWER_SHIELD_TYPES = ["dome", "phase", "deflector"] as const;

/** "" is "Other". */
export const GEAR_TYPES = ["gear", "tool", "armour", "weapon", "consumable", "mount", ""] as const;

export const EXPERIENCE_TYPES = [
    "other", "characteristic", "skill", "talent", "eliteArchetype", "psychicPower", "techPower",
] as const;

/**
 * The item renders three level selects (talent, skill and characteristic
 * advances) with the same data-id; the characteristic one comes last and its
 * value is the one read.
 */
export const EXPERIENCE_LEVELS = ["1", "2", "3", "4", "5"] as const;

export const RANGED_BASE_SELECTS = ["BS", "I", "P", "W", "F", "acrobatics"] as const;

export const MELEE_BASE_SELECTS = ["WS", "I", "P", "W", "F"] as const;

export const PSYCHIC_BASE_SELECTS = ["W", "P", "psyniscience", "logic", "Cor"] as const;

export const TECH_BASE_SELECTS = ["tech-use", "medicae", "awareness (I)", "athletics", "logic"] as const;

// ─── Roll radio groups ───────────────────────────────────────────────────────

export const AIM_OPTIONS = ["no", "half", "full"] as const;

export const TARGET_OPTIONS = ["no", "torso", "leg", "arm", "head", "joint", "eyes"] as const;

export const RANGED_RANGE_OPTIONS = ["melee", "point-blank", "short", "combat", "long", "extreme"] as const;

export const RANGED_ROF_OPTIONS = ["single", "short", "long", "suppression"] as const;

export const MELEE_BASE_OPTIONS = ["standard", "charge", "full", "careful", "mounted", "free"] as const;

export const MELEE_STANCE_OPTIONS = ["standard", "aggressive", "defensive"] as const;

export const MELEE_ROF_OPTIONS = ["single", "quick", "lightning"] as const;
