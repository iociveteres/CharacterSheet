// Fixed lists of the sheet: characteristics, skills, body parts and the
// options of every select and radio group. The schema takes the allowed
// values from them, the blocks render their labels. A label is in the page's
// language, taken by t() when the module loads (the language is fixed for the
// page); values and names stay English: the sheet stores and compares them.
import { t } from "../../i18n";

/**
 * An option of a select or radio group: its value, shown as it is (a code as
 * "I(Cr)", a number), or its value and its label in the page's language.
 */
export type Option = string | { readonly value: string; readonly label: string };

/** Options under one label, an <optgroup>. */
export interface OptionGroup {
    readonly label: string;
    readonly options: readonly Option[];
}

export const optionValue = (o: Option): string => (typeof o === "string" ? o : o.value);
export const optionLabel = (o: Option): string => (typeof o === "string" ? o : o.label);
export const optionValues = (options: readonly Option[]): string[] => options.map(optionValue);

export interface Characteristic {
    readonly key: string;
    readonly label: string;
}

/** The characteristics every sheet kind has. */
export const BASE_CHARACTERISTICS: readonly Characteristic[] = [
    { key: "WS", label: t("sheet.terms.characteristic.ws") },
    { key: "BS", label: t("sheet.terms.characteristic.bs") },
    { key: "S", label: t("sheet.terms.characteristic.s") },
    { key: "T", label: t("sheet.terms.characteristic.t") },
    { key: "A", label: t("sheet.terms.characteristic.a") },
    { key: "I", label: t("sheet.terms.characteristic.i.short") },
    { key: "P", label: t("sheet.terms.characteristic.p") },
    { key: "W", label: t("sheet.terms.characteristic.w") },
    { key: "F", label: t("sheet.terms.characteristic.f") },
];

export const CHARACTERISTICS: readonly Characteristic[] = [
    ...BASE_CHARACTERISTICS,
    { key: "Inf", label: t("sheet.terms.characteristic.inf") },
    { key: "Cor", label: t("sheet.terms.characteristic.cor") },
];

export const CHARACTERISTIC_KEYS: readonly string[] = CHARACTERISTICS.map(c => c.key);

/** What a skill row can be tested on, in the order the skill table has always listed them. */
export const SKILL_CHARACTERISTICS: readonly string[] = ["WS", "BS", "S", "T", "A", "P", "I", "W", "F", "Inf", "Cor"];

export interface SkillRow {
    readonly key: string;
    /**
     * The English name entries and tests write the skill by, whatever the
     * page's language: "Surface" of Navigate (characteristics/skillNames.ts,
     * magic/magicTest.ts).
     */
    readonly name: string;
    readonly label: string;
    /** Characteristic shown when the stored one is empty. */
    readonly def: string;
    /** The English name of the group the row is listed under, as `name`: "Navigate". */
    readonly group?: string;
    /** The heading of the group. */
    readonly groupLabel?: string;
}

/** Skills of the left column, 3_skills_left.html. Names are fixed. */
export const SKILLS_LEFT: readonly SkillRow[] = [
    { key: "acrobatics", name: "Acrobatics", label: t("sheet.termsSkills.skill.acrobatics"), def: "A" },
    { key: "athletics", name: "Athletics", label: t("sheet.termsSkills.skill.athletics"), def: "S" },
    { key: "awareness", name: "Awareness", label: t("sheet.termsSkills.skill.awareness"), def: "P" },
    { key: "charm", name: "Charm", label: t("sheet.termsSkills.skill.charm"), def: "F" },
    { key: "command", name: "Command", label: t("sheet.termsSkills.skill.command"), def: "F" },
    { key: "commerce", name: "Commerce", label: t("sheet.termsSkills.skill.commerce"), def: "I" },
    { key: "deceive", name: "Deceive", label: t("sheet.termsSkills.skill.deceive"), def: "I" },
    { key: "dodge", name: "Dodge", label: t("sheet.termsSkills.skill.dodge"), def: "A" },
    { key: "inquiry", name: "Inquiry", label: t("sheet.termsSkills.skill.inquiry"), def: "F" },
    { key: "interrogation", name: "Interrogation", label: t("sheet.termsSkills.skill.interrogation"), def: "W" },
    { key: "intimidate", name: "Intimidate", label: t("sheet.termsSkills.skill.intimidate"), def: "W" },
    { key: "logic", name: "Logic", label: t("sheet.termsSkills.skill.logic"), def: "I" },
    { key: "medicae", name: "Medicae", label: t("sheet.termsSkills.skill.medicae"), def: "I" },
    {
        key: "navigate_surface", name: "Surface", label: t("sheet.termsSkills.skill.navigateSurface"), def: "I",
        group: "Navigate", groupLabel: t("sheet.termsSkills.skillGroup.navigate"),
    },
    {
        key: "navigate_stellar", name: "Stellar", label: t("sheet.termsSkills.skill.navigateStellar"), def: "I",
        group: "Navigate", groupLabel: t("sheet.termsSkills.skillGroup.navigate"),
    },
    {
        key: "navigate_warp", name: "Warp", label: t("sheet.termsSkills.skill.navigateWarp"), def: "I",
        group: "Navigate", groupLabel: t("sheet.termsSkills.skillGroup.navigate"),
    },
    {
        key: "operate_surface", name: "Surface", label: t("sheet.termsSkills.skill.operateSurface"), def: "A",
        group: "Operate", groupLabel: t("sheet.termsSkills.skillGroup.operate"),
    },
    {
        key: "operate_aeronautica", name: "Aeronautica", label: t("sheet.termsSkills.skill.operateAeronautica"), def: "A",
        group: "Operate", groupLabel: t("sheet.termsSkills.skillGroup.operate"),
    },
    {
        key: "operate_void", name: "Void", label: t("sheet.termsSkills.skill.operateVoid"), def: "I",
        group: "Operate", groupLabel: t("sheet.termsSkills.skillGroup.operate"),
    },
    { key: "parry", name: "Parry", label: t("sheet.termsSkills.skill.parry"), def: "WS" },
    { key: "psyniscience", name: "Psyniscience", label: t("sheet.termsSkills.skill.psyniscience"), def: "P" },
    { key: "scrutiny", name: "Scrutiny", label: t("sheet.termsSkills.skill.scrutiny"), def: "P" },
    { key: "security", name: "Security", label: t("sheet.termsSkills.skill.security"), def: "I" },
    { key: "sleight_of_hand", name: "Sleight of Hand", label: t("sheet.termsSkills.skill.sleightOfHand"), def: "A" },
    { key: "stealth", name: "Stealth", label: t("sheet.termsSkills.skill.stealth"), def: "A" },
    { key: "survival", name: "Survival", label: t("sheet.termsSkills.skill.survival"), def: "P" },
    { key: "tech-use", name: "Tech-Use", label: t("sheet.termsSkills.skill.techUse"), def: "I" },
];

const numberedSkills = (group: string, groupLabel: string, suffix: string, count: number): SkillRow[] =>
    Array.from({ length: count }, (_, i) => ({ key: `${i + 1}_${suffix}`, name: "", label: "", def: "I", group, groupLabel }));

/** Skills of the right column, 4_skills_right.html. Names are editable. */
export const SKILLS_RIGHT: readonly SkillRow[] = [
    ...numberedSkills("Linguistics", t("sheet.termsSkills.skillGroup.linguistics"), "linguistics", 5),
    ...numberedSkills("Trade", t("sheet.termsSkills.skillGroup.trade"), "trade", 5),
    ...numberedSkills("Common Lore", t("sheet.termsSkills.skillGroup.commonLore"), "common_lore", 6),
    ...numberedSkills("Scholastic Lore", t("sheet.termsSkills.skillGroup.scholasticLore"), "scholastic_lore", 5),
    ...numberedSkills("Forbidden Lore", t("sheet.termsSkills.skillGroup.forbiddenLore"), "forbidden_lore", 5),
];

/** The natures of a psyker's gift (Psykana type). */
export const PSYKANA_TYPES: readonly Option[] = [
    { value: "Bound", label: t("sheet.termsPowers.psykanaType.bound") },
    { value: "Unbound", label: t("sheet.termsPowers.psykanaType.unbound") },
    { value: "Daemonic", label: t("sheet.termsPowers.psykanaType.daemonic") },
];

/** The cost in XP of the talent Power Rating up to PR X: base + perPR × (X − 1). */
export interface PRCost {
    readonly base: number;
    readonly perPR: number;
}

/**
 * A class trait «X Spellcasting» of Pathfinder Crusade, a checkbox of the
 * Magic tab (magic/spellcastingRules.ts): how its caster casts, on what, the base
 * of its pool, its gift and whether it prepares.
 */
export interface SpellcastingVariant {
    /** Its checkbox in the spellcasting block; an Arts one's is also its pool in the focus block. */
    readonly key: string;
    /** Its short label in lists, "Arcane"; an Arts variant's is its class, "Bard". */
    readonly label: string;
    /** The class trait it is, "Arcane Spellcasting", "Bard Spellcasting". */
    readonly trait: string;
    /** "pr": its spells are cast by PR; "arts": by a half-caster, on a skill (magic/artsRules.ts). */
    readonly way: "pr" | "arts";
    /** What Cast tests a PR spell on: a characteristic. */
    readonly test?: string;
    /** The base of its pool, the mana or its Focus, an expression of the pool's max. */
    readonly base: string;
    /** The nature of the gift of a PR variant (psykanaType). */
    readonly gift?: string;
    readonly prepares: boolean;
    /** What an Arts variant's pool is called, and the classes of Arts (X) it pays for. */
    readonly pool?: string;
    readonly classes?: readonly string[];
    /** The share of the XP cost of a spell its caster pays, 1 when unset. */
    readonly spellCost?: number;
    /** What the talent Power Rating costs a caster of a PR variant. */
    readonly prCost?: PRCost;
}

/**
 * The characteristics and skills of a sheet kind, as lists of them (e.g.
 * test options) offer them, and the natures of the gift its psykers have.
 */
export interface StatSet {
    readonly characteristics: readonly Characteristic[];
    /** What a skill can be tested on. */
    readonly skillCharacteristics: readonly string[];
    readonly skillsLeft: readonly SkillRow[];
    readonly skillsRight: readonly SkillRow[];
    readonly psykanaTypes: readonly Option[];
    /** Names a Magic test gives a family of specialisations by, "Trade(Bardic)", and its members (magic/magicTest.ts). */
    readonly skillFamilies: Readonly<Record<string, readonly string[]>>;
    /** The Spellcasting variants a caster ticks, in their order; none in a kind whose psykers pick the gift. */
    readonly spellcasting: readonly SpellcastingVariant[];
    /**
     * What the talent Power Rating costs a caster without a PR variant ticked
     * (an elite archetype); null in a kind that prices it as any talent.
     */
    readonly prCost: PRCost | null;
    /** Whether advancements are allied or hostile to the character's alignment, Black Crusade's Devotion. */
    readonly devotion: boolean;
    /** The aptitudes of specialisations, beside CHARACTERISTIC_APTITUDES; General is every character's. */
    readonly aptitudes: readonly Characteristic[];
    /**
     * The profiles of the Natural Weapons traits, which melee attacks link to (weapons/traitLinkRules.ts); none in a kind
     * whose melee collection lacks them.
     */
    readonly naturalWeapons: readonly NaturalWeapon[];
    /** How many half-actions a Reload of 1 in the kind's tables takes (weapons/reloadRules.ts). */
    readonly reloadUnit: 1 | 2;
    /** What the damage of attacks and powers can be. */
    readonly damageTypes: readonly Option[];
}

/** A profile of the Natural Weapons traits; the melee collection names it "Claws (Natural Weapons)". */
export interface NaturalWeapon {
    readonly name: string;
    readonly ru: string;
}

/** The aptitudes named by a characteristic, the same in every kind. */
export const CHARACTERISTIC_APTITUDES: readonly Characteristic[] = BASE_CHARACTERISTICS.map(c => (c.key === "I" ? { ...c, label: t("sheet.terms.characteristic.i") } : c));

/** The aptitude every character has without picking it (profile/profileComputeds.ts). */
export const GENERAL_APTITUDE: Characteristic = { key: "Gen", label: t("sheet.terms.aptitude.gen") };

/** The damage types of Black Crusade; a kind adds its own in StatSet.damageTypes. */
export const DAMAGE_TYPES: readonly Option[] = ["I", "I(Cr)", "R", "X", "X(Fr)", "E", "E(El)", "E(Ls)", "E(Fl)", "C", "C(Tx)"];

export const BLACK_CRUSADE_STATS: StatSet = {
    characteristics: CHARACTERISTICS,
    skillCharacteristics: SKILL_CHARACTERISTICS,
    skillsLeft: SKILLS_LEFT,
    skillsRight: SKILLS_RIGHT,
    psykanaTypes: PSYKANA_TYPES,
    skillFamilies: {},
    spellcasting: [],
    prCost: null,
    devotion: true,
    naturalWeapons: [],
    // Its tables write Reload in actions: ½ a half one, 1 a full one.
    reloadUnit: 2,
    damageTypes: DAMAGE_TYPES,
    aptitudes: [
        { key: "Off", label: t("sheet.terms.aptitude.off") },
        { key: "Fin", label: t("sheet.terms.aptitude.fin") },
        { key: "Def", label: t("sheet.terms.aptitude.def") },
        { key: "Psi", label: t("sheet.terms.aptitude.psi") },
        { key: "Tec", label: t("sheet.terms.aptitude.tec") },
        { key: "Knw", label: t("sheet.terms.aptitude.knw") },
        { key: "Soc", label: t("sheet.terms.aptitude.soc") },
        { key: "FC", label: t("sheet.terms.aptitude.fc") },
    ],
};

/**
 * The words of a kind for its psykana in the labels of the sheet: Black
 * Crusade's psychic powers are the spells of Pathfinder Crusade's magic.
 * A phrase that names a power is whole, a key of its own per kind: Russian
 * declines the word ("для новой психосилы"), so it is never glued from it.
 * Black Crusade's phrases are sheet.magic.psykana.*.
 */
export interface PsykanaTerms {
    /** The tab and the heading of the block. */
    readonly psykana: string;
    readonly psykanaType: string;
    /** A power without a name. */
    readonly psychicPower: string;
    /** The powers as a heading: a section of the stat block. */
    readonly psychicPowers: string;
    /** What the block rolls, as its test options name it: "Powers are tested on". */
    readonly rolls: string;
    /** The test of a cast. */
    readonly psychotest: string;
    /** The label of a roll of a power without a name, sent to the chat. */
    readonly unknownPower: string;
    readonly noPRLeft: string;
    readonly powerTraitsTitle: string;
    readonly phenomenaModTitle: string;
    readonly ignoresSustained: string;
    readonly sustainedPowers: string;
    /** Sustained Powers as a row of the phenomena and a rule under the ⚙ of the heading name it. */
    readonly sustainedLabel: string;
    readonly sustainedCountedTitle: string;
    readonly noCastYet: string;
    readonly sustainPenaltyTitle: string;
    readonly setUnderGearTitle: string;
    readonly marksSustainedTitle: string;
    /** The rules under the ⚙ of the heading, and its title. */
    readonly sustainedRuleTitle: string;
    readonly cycleRuleTitle: string;
    readonly phenomenaRuleTitle: string;
    readonly headingTitle: string;
    /** The one-time notice of the rules the sheet counts; `typed`, the Sustained Powers typed before. */
    readonly countsNotice: string;
    readonly typedSustainedNotice: (typed: number) => string;
    /** The title of the Current PR of the stat block. */
    readonly currentPRTitle: string;
}

export const BLACK_CRUSADE_PSYKANA_TERMS: PsykanaTerms = {
    psykana: t("sheet.termsPowers.psy.psykana"),
    psykanaType: t("sheet.termsPowers.psy.psykanaType"),
    psychicPower: t("sheet.termsPowers.psy.psychicPower"),
    psychicPowers: t("sheet.magic.psykana.psychicPowers"),
    rolls: t("sheet.magic.psykana.rolls"),
    psychotest: t("sheet.termsPowers.rollDomain.psychic"),
    unknownPower: t("sheet.magic.psykana.unknownPower"),
    noPRLeft: t("sheet.magic.psykana.noPRLeft"),
    powerTraitsTitle: t("sheet.magic.psykana.powerTraitsTitle"),
    phenomenaModTitle: t("sheet.magic.psykana.phenomenaModTitle"),
    ignoresSustained: t("sheet.magic.psykana.ignoresSustained"),
    sustainedPowers: t("sheet.magic.psykana.sustainedPowers"),
    sustainedLabel: t("sheet.magic.psykana.sustainedLabel"),
    sustainedCountedTitle: t("sheet.magic.psykana.sustainedCountedTitle"),
    noCastYet: t("sheet.magic.psykana.noCastYet"),
    sustainPenaltyTitle: t("sheet.magic.psykana.sustainPenaltyTitle"),
    setUnderGearTitle: t("sheet.magic.psykana.setUnderGearTitle"),
    marksSustainedTitle: t("sheet.magic.psykana.marksSustainedTitle"),
    sustainedRuleTitle: t("sheet.magic.psykana.sustainedRuleTitle"),
    cycleRuleTitle: t("sheet.magic.psykana.cycleRuleTitle"),
    phenomenaRuleTitle: t("sheet.magic.psykana.phenomenaRuleTitle"),
    headingTitle: t("sheet.magic.psykana.headingTitle"),
    countsNotice: t("sheet.magic.psykana.countsNotice"),
    typedSustainedNotice: typed => t("sheet.magic.psykana.typedSustainedNotice", { typed }),
    currentPRTitle: t("sheet.magic.psykana.currentPRTitle"),
};

export interface BodyPart {
    readonly key: string;
    readonly label: string;
    /** Hit location roll range. */
    readonly hits: string;
}

// Literal keys, so the armour group of the schema types each part.
export const BODY_PARTS = [
    { key: "head", label: t("sheet.terms.bodyPart.head"), hits: "1-10" },
    { key: "leftArm", label: t("sheet.terms.bodyPart.leftArm"), hits: "11-20" },
    { key: "body", label: t("sheet.terms.bodyPart.body"), hits: "31-70" },
    { key: "rightArm", label: t("sheet.terms.bodyPart.rightArm"), hits: "21-30" },
    { key: "leftLeg", label: t("sheet.terms.bodyPart.leftLeg"), hits: "71-85" },
    { key: "rightLeg", label: t("sheet.terms.bodyPart.rightLeg"), hits: "86-00" },
] as const satisfies readonly BodyPart[];

export type BodyPartKey = (typeof BODY_PARTS)[number]["key"];

/**
 * Characteristics whose bonus can be added to initiative, and the checkbox of
 * each; a kind has the checkboxes of its characteristics.
 */
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
    { characteristic: "Fa", field: "faBonus" },
] as const satisfies readonly { readonly characteristic: string; readonly field: string }[];

// ─── Select options ──────────────────────────────────────────────────────────

export const SIZE_OPTIONS: readonly Option[] = [
    { value: "-3", label: `${t("sheet.terms.size.miniscule")} (-3)` },
    { value: "-2", label: `${t("sheet.terms.size.puny")} (-2)` },
    { value: "-1", label: `${t("sheet.terms.size.weedy")} (-1)` },
    { value: "0", label: `${t("sheet.terms.size.average")} (0)` },
    { value: "1", label: `${t("sheet.terms.size.hulking")} (1)` },
    { value: "2", label: `${t("sheet.terms.size.enormous")} (2)` },
    { value: "3", label: `${t("sheet.terms.size.massive")} (3)` },
    { value: "4", label: `${t("sheet.terms.size.immense")} (4)` },
    { value: "5", label: `${t("sheet.terms.size.monumental")} (5)` },
    { value: "6", label: `${t("sheet.terms.size.titanic")} (6)` },
];

export const FATIGUE_MODES: readonly Option[] = [
    { value: "all", label: t("sheet.terms.fatigueMode.all") },
    { value: "mental", label: t("sheet.terms.fatigueMode.mental") },
    { value: "physical", label: t("sheet.terms.fatigueMode.physical") },
    { value: "nothing", label: t("sheet.terms.fatigueMode.nothing") },
];

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

export const ENTRY_TYPES: readonly Option[] = [
    { value: "char_bonus", label: t("sheet.schema.entryType.charBonus") },
    { value: "char_cap", label: t("sheet.schema.entryType.charCap") },
    { value: "char_cap_bonus", label: t("sheet.schema.entryType.charCapBonus") },
    { value: "char_override", label: t("sheet.schema.entryType.charOverride") },
    { value: "roll_bonus", label: t("sheet.schema.entryType.rollBonus") },
    { value: "skill_bonus", label: t("sheet.schema.entryType.skillBonus") },
    { value: "ablative_wounds", label: t("sheet.schema.entryType.ablativeWounds") },
    { value: "initiative_bonus", label: t("sheet.schema.entryType.initiativeBonus") },
    { value: "movement_bonus", label: t("sheet.schema.entryType.movementBonus") },
    { value: "bonus_ap", label: t("sheet.schema.entryType.bonusAp") },
    { value: "weapon_bonus", label: t("sheet.schema.entryType.weaponBonus") },
];

/** The fields of a weapon a weapon_bonus entry adds to (weapons/weaponBonus.ts). */
export const WEAPON_FIELDS: readonly Option[] = [
    { value: "rng", label: t("sheet.termsArms.weaponField.rng.short") },
    { value: "rngMax", label: t("sheet.termsArms.weaponField.rngMax.short") },
    { value: "rngMin", label: t("sheet.termsArms.weaponField.rngMin.short") },
    { value: "balance", label: t("sheet.termsArms.weaponField.balance") },
    { value: "dmg", label: t("sheet.termsArms.weaponField.dmg.short") },
    { value: "pen", label: t("sheet.termsArms.weaponField.pen.short") },
    { value: "reload", label: t("sheet.termsArms.weaponField.reload") },
    { value: "hit", label: t("sheet.termsArms.weaponField.hit") },
    { value: "parry", label: t("sheet.termsSkills.skill.parry") },
];

/**
 * Rolls a roll_bonus entry can be limited to: each has its own Roll button on
 * the sheet (rolls/rollParts.tsx). A characteristic button and a skill roll
 * are ordinary tests, of no domain.
 */
export const ROLL_DOMAINS = [
    { value: "ranged", label: t("sheet.termsPowers.rollDomain.ranged.short"), title: t("sheet.schema.rollDomain.ranged") },
    { value: "melee", label: t("sheet.termsPowers.rollDomain.melee.short"), title: t("sheet.schema.rollDomain.melee") },
    { value: "psychic", label: t("sheet.termsPowers.rollDomain.psychic.short"), title: t("sheet.schema.rollDomain.psychic") },
    { value: "techPower", label: t("sheet.termsPowers.rollDomain.techPower.short"), title: t("sheet.schema.rollDomain.techPower") },
    { value: "compensation", label: t("sheet.termsPowers.rollDomain.compensation.short"), title: t("sheet.schema.rollDomain.compensation") },
] as const satisfies readonly { value: string; label: string; title: string }[];

export type RollDomain = (typeof ROLL_DOMAINS)[number]["value"];

/** What the mode select of a roll bonus explains on hover. */
export const ROLL_DOMAIN_MODES_TITLE = t("sheet.schema.rollDomainMode.title");

export const ROLL_DOMAIN_MODES: readonly Option[] = [
    { value: "", label: t("sheet.schema.rollDomainMode.all") },
    { value: "only", label: t("sheet.schema.rollDomainMode.only") },
    { value: "except", label: t("sheet.schema.rollDomainMode.except") },
];

export const AP_TYPES: readonly Option[] = [
    { value: "natural", label: t("sheet.termsArms.apType.natural.short") },
    { value: "daemonic", label: t("sheet.termsArms.apType.daemonic") },
    { value: "machine", label: t("sheet.termsArms.apType.machine") },
    { value: "other", label: t("sheet.termsArms.apType.other") },
];

/** The quality of an implant or item, which the tests of the tech powers that need it take (tech/tech.ts). */
export const QUALITIES: readonly Option[] = [
    { value: "Poor", label: t("sheet.termsArms.craftsmanship.poor") },
    { value: "Common", label: t("sheet.termsArms.craftsmanship.common.short") },
    { value: "Good", label: t("sheet.termsArms.craftsmanship.good") },
    { value: "Best", label: t("sheet.termsArms.craftsmanship.best") },
];

/** The resources of a tech-priest: cognition and energy, as their signs. */
export const RESOURCES: readonly Option[] = [{ value: "cognition", label: "⚙" }, { value: "energy", label: "🗲" }];

export const RANGED_CLASSES: readonly Option[] = [
    { value: "pistol", label: t("sheet.termsArms.rangedClass.pistol") },
    { value: "rifle", label: t("sheet.termsArms.rangedClass.rifle") },
    { value: "long rifle", label: t("sheet.termsArms.rangedClass.longRifle") },
    { value: "heavy", label: t("sheet.termsArms.rangedClass.heavy") },
    { value: "throwing", label: t("sheet.termsArms.rangedClass.throwing") },
    { value: "grenade", label: t("sheet.termsArms.rangedClass.grenade") },
    { value: "special", label: t("sheet.termsArms.rangedClass.special") },
];

/** The ranged classes that are thrown: S.b×3 is their range when they have none (weapons/rangeRules.ts). */
export const THROWN_CLASSES: readonly string[] = ["throwing", "grenade"];

export const MELEE_GROUPS: readonly Option[] = [
    { value: "primary", label: t("sheet.termsArms.meleeGroup.primary") },
    { value: "primary (shield)", label: t("sheet.termsArms.meleeGroup.primaryShield") },
    { value: "chain", label: t("sheet.termsArms.meleeGroup.chain") },
    { value: "shock", label: t("sheet.termsArms.meleeGroup.shock") },
    { value: "power", label: t("sheet.termsArms.meleeGroup.power") },
    { value: "exotic", label: t("sheet.termsArms.meleeGroup.exotic") },
    { value: "mechadendrite", label: t("sheet.termsArms.meleeGroup.mechadendrite") },
];

export const MELEE_PROFILES: readonly Option[] = [
    { value: "mace", label: t("sheet.termsArms.meleeProfile.mace") },
    { value: "glaive", label: t("sheet.termsArms.meleeProfile.glaive") },
    { value: "flail", label: t("sheet.termsArms.meleeProfile.flail") },
    { value: "whip", label: t("sheet.termsArms.meleeProfile.whip") },
    { value: "claws", label: t("sheet.termsArms.meleeProfile.claws") },
    { value: "claws.h", label: t("sheet.termsArms.meleeProfile.clawsH.short") },
    { value: "claws.a", label: t("sheet.termsArms.meleeProfile.clawsA.short") },
    { value: "spear", label: t("sheet.termsArms.meleeProfile.spear") },
    { value: "hook", label: t("sheet.termsArms.meleeProfile.hook") },
    { value: "fist", label: t("sheet.termsArms.meleeProfile.fist") },
    { value: "fist.a", label: t("sheet.termsArms.meleeProfile.fistA.short") },
    { value: "sword", label: t("sheet.termsArms.meleeProfile.sword") },
    { value: "rapier", label: t("sheet.termsArms.meleeProfile.rapier") },
    { value: "saber", label: t("sheet.termsArms.meleeProfile.saber") },
    { value: "hammer", label: t("sheet.termsArms.meleeProfile.hammer") },
    { value: "axe", label: t("sheet.termsArms.meleeProfile.axe") },
    { value: "knife", label: t("sheet.termsArms.meleeProfile.knife") },
    { value: "staff", label: t("sheet.termsArms.meleeProfile.staff") },
    { value: "bayonet", label: t("sheet.termsArms.meleeProfile.bayonet") },
    { value: "shield", label: t("sheet.termsArms.meleeProfile.shield") },
    { value: "bite", label: t("sheet.termsArms.meleeProfile.bite") },
    { value: "no", label: t("sheet.termsArms.meleeProfile.no") },
    { value: "", label: t("sheet.termsArms.meleeProfile.other") },
];

/** The melee stances (weapons/stanceRules.ts); none is Standard. */
export const MELEE_STANCES: readonly Option[] = [
    { value: "", label: t("sheet.termsArms.stance.standard.short") },
    { value: "aggressive", label: t("sheet.termsArms.stance.aggressive.short") },
    { value: "defensive", label: t("sheet.termsArms.stance.defensive.short") },
    { value: "covering", label: t("sheet.termsArms.stance.covering.short") },
    { value: "springy", label: t("sheet.termsArms.stance.springy.short") },
    { value: "palisade", label: t("sheet.termsArms.stance.palisade") },
];

export const SHIELD_SUBTYPES: readonly Option[] = [
    { value: "buckler", label: t("sheet.termsArms.shield.buckler") },
    { value: "targ", label: t("sheet.termsArms.shield.targ") },
    { value: "ecu", label: t("sheet.termsArms.shield.ecu") },
    { value: "round", label: t("sheet.termsArms.shield.round") },
    { value: "teardrop", label: t("sheet.termsArms.shield.teardrop") },
    { value: "light tower", label: t("sheet.termsArms.shield.lightTower") },
    { value: "tower", label: t("sheet.termsArms.shield.tower") },
];

export const SHIELD_ARMS: readonly Option[] = [
    { value: "left", label: t("sheet.termsArms.shieldArm.left") },
    { value: "right", label: t("sheet.termsArms.shieldArm.right") },
];

export const POWER_SHIELD_NATURES: readonly Option[] = [
    { value: "tech", label: t("sheet.termsArms.powerShieldNature.tech") },
    { value: "arcane", label: t("sheet.termsArms.powerShieldNature.arcane") },
];

export const POWER_SHIELD_TYPES: readonly Option[] = [
    { value: "dome", label: t("sheet.termsArms.powerShieldType.dome") },
    { value: "phase", label: t("sheet.termsArms.powerShieldType.phase") },
    { value: "deflector", label: t("sheet.termsArms.powerShieldType.deflector") },
];

export const GEAR_TYPES: readonly Option[] = [
    { value: "gear", label: t("sheet.termsArms.gearType.gear") },
    { value: "tool", label: t("sheet.termsArms.gearType.tool") },
    { value: "armour", label: t("sheet.termsArms.gearType.armour") },
    { value: "weapon", label: t("sheet.termsArms.gearType.weapon") },
    { value: "consumable", label: t("sheet.termsArms.gearType.consumable") },
    { value: "mount", label: t("sheet.termsArms.gearType.mount") },
    { value: "", label: t("sheet.termsArms.gearType.other") },
];

/**
 * The inlay gems of Pathfinder Crusade items and what they add to the
 * capacity (wiki «iv арсенал › материалы › Инкрустация»). Mirrors the
 * collection "inlays": the sheet keeps only the gem's name.
 */
export const INLAY_GEMS = [
    { name: "Quartz", capacityBonus: 1 },
    { name: "Onyx", capacityBonus: 2 },
    { name: "Ruby", capacityBonus: 4 },
    { name: "Emerald", capacityBonus: 6 },
    { name: "Diamond", capacityBonus: 8 },
] as const;

export const EXPERIENCE_TYPES: readonly Option[] = [
    { value: "other", label: t("sheet.terms.experienceType.other") },
    { value: "characteristic", label: t("sheet.terms.experienceType.characteristic") },
    { value: "skill", label: t("sheet.terms.experienceType.skill") },
    { value: "talent", label: t("sheet.terms.experienceType.talent") },
    { value: "eliteArchetype", label: t("sheet.terms.experienceType.eliteArchetype") },
    { value: "psychicPower", label: t("sheet.termsPowers.psy.psychicPower") },
    { value: "techPower", label: t("sheet.termsPowers.tech.techPower") },
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

/** The names of the talent Power Rating, as nameKey gives them (magic/spellcastingRules.ts). */
export const POWER_RATING_TALENT: readonly string[] = ["power rating", "рейтинг силы"];

/** The PR the talent Power Rating is bought up to, its level; PR 1 is not bought. */
export const POWER_RATING_LEVELS: readonly Option[] = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(pr => ({ value: String(pr), label: `PR ${pr}` }));

/** The levels of every type are a prefix of the characteristic ones. */
export const EXPERIENCE_LEVELS: readonly string[] = optionValues(EXPERIENCE_LEVELS_BY_TYPE.characteristic);

// ─── Roll columns ────────────────────────────────────────────────────────────

/** A column of an attack's roll dropdown, such as aim or range. */
export interface RollColumn<K extends string = string> {
    /** The column's key in the roll. */
    readonly key: K;
    readonly label: string;
    readonly options: readonly Option[];
    /** The option that counts when none is selected; the roll label leaves it out. */
    readonly default: string;
    /** How the roll label names an option whose label is a short form (rolls/rollParts.ts selectedNames). */
    readonly names?: { readonly [value: string]: string };
}

/** The field of a roll column that holds an option's modifier: "point-blank" is "pointBlank". */
export const modifierField = (value: string): string => value.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

/** Keeps a column's key as a literal type, so the schema types each column of a roll. */
const column = <K extends string>(c: RollColumn<K>) => c;

const AIM = column({
    key: "aim", label: t("sheet.termsRolls.rollColumn.aim"), default: "no",
    options: [
        { value: "no", label: t("sheet.termsRolls.aim.no.short") },
        { value: "half", label: t("sheet.termsRolls.aim.half.short") },
        { value: "full", label: t("sheet.termsRolls.aim.full.short") },
    ],
    names: { half: t("sheet.termsRolls.aim.half"), full: t("sheet.termsRolls.aim.full") },
});

const TARGET = column({
    key: "target", label: t("sheet.termsRolls.rollColumn.target"), default: "no",
    options: [
        { value: "no", label: t("sheet.termsRolls.target.no.short") },
        { value: "torso", label: t("sheet.termsRolls.target.torso") },
        { value: "leg", label: t("sheet.terms.bodyPart.leg") },
        { value: "arm", label: t("sheet.terms.bodyPart.arm") },
        { value: "head", label: t("sheet.terms.bodyPart.head") },
        { value: "joint", label: t("sheet.termsRolls.target.joint") },
        { value: "eyes", label: t("sheet.termsRolls.target.eyes") },
    ],
});

export const RANGED_ROLL_COLUMNS = [
    AIM,
    TARGET,
    column({
        key: "range", label: t("sheet.termsRolls.rollColumn.range"), default: "combat",
        options: [
            { value: "melee", label: t("sheet.termsRolls.range.melee.short") },
            { value: "point-blank", label: t("sheet.termsRolls.range.pointBlank.short") },
            { value: "short", label: t("sheet.termsRolls.range.short.short") },
            { value: "combat", label: t("sheet.termsRolls.range.combat.short") },
            { value: "long", label: t("sheet.termsRolls.range.long.short") },
            { value: "extreme", label: t("sheet.termsRolls.range.extreme.short") },
        ],
        names: {
            melee: t("sheet.schema.rollName.range.melee"),
            "point-blank": t("sheet.schema.rollName.range.pointBlank"),
            short: t("sheet.schema.rollName.range.short"),
            long: t("sheet.schema.rollName.range.long"),
            extreme: t("sheet.schema.rollName.range.extreme"),
        },
    }),
    column({
        key: "rof", label: t("sheet.termsArms.weaponField.rof.short"), default: "single",
        options: [
            { value: "single", label: t("sheet.termsRolls.rof.single.short") },
            { value: "short", label: t("sheet.termsRolls.rof.short.short") },
            { value: "long", label: t("sheet.termsRolls.rof.long.short") },
            { value: "suppression", label: t("sheet.termsRolls.rof.suppression.short") },
        ],
        names: { short: t("sheet.termsRolls.rof.short"), long: t("sheet.termsRolls.rof.long"), suppression: t("sheet.schema.rollName.rof.suppression") },
    }),
] as const;

export const MELEE_ROLL_COLUMNS = [
    AIM,
    TARGET,
    column({
        key: "base", label: t("sheet.termsRolls.rollColumn.base"), default: "standard",
        options: [
            { value: "standard", label: t("sheet.termsRolls.meleeBase.standard.short") },
            { value: "charge", label: t("sheet.termsRolls.meleeBase.charge") },
            { value: "full", label: t("sheet.termsRolls.meleeBase.full.short") },
            { value: "careful", label: t("sheet.termsRolls.meleeBase.careful.short") },
            { value: "mounted", label: t("sheet.termsRolls.meleeBase.mounted.short") },
            { value: "free", label: t("sheet.termsRolls.meleeBase.free.short") },
        ],
        names: {
            full: t("sheet.termsRolls.meleeBase.full"),
            careful: t("sheet.schema.rollName.meleeBase.careful"),
            mounted: t("sheet.schema.rollName.meleeBase.mounted"),
            free: t("sheet.schema.rollName.meleeBase.free"),
        },
    }),
    column({
        key: "rof", label: t("sheet.termsArms.weaponField.rof.short"), default: "single",
        options: [
            { value: "single", label: t("sheet.termsRolls.meleeRof.single.short") },
            { value: "quick", label: t("sheet.termsRolls.meleeRof.quick.short") },
            { value: "lightning", label: t("sheet.termsRolls.meleeRof.lightning.short") },
        ],
        names: { quick: t("sheet.termsRolls.meleeRof.quick"), lightning: t("sheet.termsRolls.meleeRof.lightning") },
    }),
] as const;
