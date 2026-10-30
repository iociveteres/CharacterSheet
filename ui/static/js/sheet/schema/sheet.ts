// The sheet schema: every block and item of the sheet (ui/static/js/sheet/blocks).
// The kinds share it but for their characteristics and skills, which
// sheetSchemaOf takes from the kind, and the blocks and fields a kind has
// alone (withOwnFields), as the mana of Pathfinder Crusade.

import {
    ALIGNMENTS, AP_TYPES, BLACK_CRUSADE_STATS, BODY_PARTS, DAMAGE_TYPES,
    ENTRY_TYPES, EXPERIENCE_LEVELS, EXPERIENCE_TYPES, FATIGUE_MODES, GEAR_TYPES, INITIATIVE_BONUSES, INLAY_GEMS, QUALITIES, RESOURCES,
    MELEE_GROUPS, MELEE_PROFILES, MELEE_STANCES, POWER_RATING_LEVELS, POWER_SHIELD_NATURES, POWER_SHIELD_TYPES,
    RANGED_CLASSES, ROLL_DOMAINS, ROLL_DOMAIN_MODES, SHIELD_ARMS, WEAPON_FIELDS,
    SHIELD_SUBTYPES, SIZE_OPTIONS, modifierField, optionValue, optionValues, type Option, type SkillRow, type StatSet,
    MELEE_ROLL_COLUMNS, RANGED_ROLL_COLUMNS, type RollColumn,
} from "./constants";
import {
    checkbox, computed, grid, group, hidden, number, openSelect, optionalGroup, radio, select, text, textarea,
    type Fields, type GroupSpec, type Infer, type SignalsOf,
} from "./spec";

// Literal keys give the group a field per key; a spread drops the index
// signature that plain strings give.
const fromEntries = <K extends string, V>(keys: readonly K[], value: (key: K) => V): { [P in K]: V } =>
    Object.fromEntries(keys.map(key => [key, value(key)])) as { [P in K]: V };

// ─── Items ───────────────────────────────────────────────────────────────────

/** An entry of a condition, gear item or implant. The type picks the visible fields. */
export const conditionEntry = group({
    type: select(ENTRY_TYPES),
    name: text(),
    bonus: text(),
    unnaturalBonus: text(),
    cap: text(),
    // A char_cap_bonus entry: what it raises the caps of its characteristics by;
    // inside a gear item only that item's caps (state/caps.ts).
    capBonus: text(),
    overrideValue: text(),
    overrideUnnatural: text(),
    rollBonus: text(),
    skillBonus: text(),
    ablativeWounds: text(),
    initiativeBonus: text(),
    movementBonus: text(),
    apType: select(AP_TYPES),
    apValue: text(),
    domainMode: select(ROLL_DOMAIN_MODES),
    // A weapon_bonus entry: the field of the weapons its name names, and what it adds.
    weaponField: select(WEAPON_FIELDS),
    weaponBonus: text(),
    domains: group(fromEntries(ROLL_DOMAINS.map(d => d.value), () => checkbox())),
});

const conditionEntries = grid(conditionEntry, 1);

export const condition = group({
    enabled: checkbox({ initial: true }),
    name: text(),
    stacks: number(0, { initial: 1 }),
    entries: conditionEntries,
});

const customSkill = (stats: StatSet) => group({
    name: text(),
    characteristic: select(stats.characteristics.map(c => c.key)),
    plus0: checkbox(),
    plus10: checkbox(),
    plus20: checkbox(),
    plus30: checkbox(),
    miscBonus: number(),
    difficulty: computed(),
});

/** Notes, traits, talents, mutations, mental disorders and diseases. */
export const namedDescription = group({
    name: text(),
    description: textarea(),
});

/**
 * A way the character moves (state/movement.ts): its SPD expression and what
 * the Half, Full, Charge and Run distances multiply it by, each shown as its
 * computed output.
 */
export const movementMode = group({
    name: text(),
    spd: text(),
    // A cleared multiplier is the rules' one, not 0.
    halfMult: number(1, { emptyAsDefault: true }),
    fullMult: number(2, { emptyAsDefault: true }),
    chargeMult: number(3, { emptyAsDefault: true }),
    runMult: number(6, { emptyAsDefault: true }),
    half: computed<string>(),
    full: computed<string>(),
    charge: computed<string>(),
    run: computed<string>(),
});

export const resourceTracker = group({
    name: text(),
    value: number(),
});

export const powerShield = group({
    name: text(),
    rating: text(),
    nature: select(POWER_SHIELD_NATURES),
    type: select(POWER_SHIELD_TYPES),
    description: textarea(),
});

const rollExtra = group({
    name: text(),
    value: number(),
    enabled: checkbox(),
});

/** A column of a roll dropdown: the selected option and the modifier of each option. */
const rollColumn = (column: RollColumn) => group({
    selected: radio(column.options),
    ...fromEntries(column.options.map(o => modifierField(optionValue(o))), () => number()),
});

/** The columns of a roll dropdown by key; the cast keeps the keys, which Object.fromEntries loses. */
const rollColumns = <C extends readonly RollColumn[]>(columns: C) =>
    Object.fromEntries(columns.map(c => [c.key, rollColumn(c)])) as { [K in C[number]["key"]]: ReturnType<typeof rollColumn> };

/** What a modifier adds to a weapon's damage or penetration, e.g. "S.b" (damage.ts). */
export const weaponMod = group({
    expr: text(),
    enabled: checkbox({ initial: true }),
});

const weaponMods = grid(weaponMod, 1);

export const rangedAttack = group({
    name: text(),
    class: select(RANGED_CLASSES),
    range: text(),
    // Factors too, as "×2" (state/range.ts).
    rangeMods: weaponMods,
    damage: text(),
    damageMods: weaponMods,
    pen: text(),
    penMods: weaponMods,
    damageType: select(DAMAGE_TYPES),
    rofSingle: text(),
    rofShort: text(),
    rofLong: text(),
    clipCur: text(),
    clipMax: text(),
    reload: text(),
    special: text(),
    description: textarea(),
    // The id of the gear item the attack is linked to (state/itemLink.ts).
    item: text(),
    roll: optionalGroup({
        ...rollColumns(RANGED_ROLL_COLUMNS),
        extra1: rollExtra,
        extra2: rollExtra,
        // The id of one of the block's testOptions.
        testOption: openSelect(),
    }),
});

export const meleeProfile = group({
    profile: select(MELEE_PROFILES, ""),
    range: text(),
    damage: text(),
    damageMods: weaponMods,
    pen: text(),
    penMods: weaponMods,
    damageType: select(DAMAGE_TYPES),
    special: text(),
});

export const meleeAttack = group({
    name: text(),
    group: select(MELEE_GROUPS),
    grip: text(),
    // The grip held, by its key in state/grips.ts; empty is the primary.
    gripSelected: text(),
    balance: text(),
    // What a Parry with the weapon adds, numbers and references (state/parry.ts).
    parryMods: weaponMods,
    shield: group({
        subtype: select(SHIELD_SUBTYPES),
        ap: number(),
        defenseSectors: text(),
        arm: select(SHIELD_ARMS),
        equipped: checkbox(),
    }),
    tabs: grid(meleeProfile, 1),
    description: textarea(),
    // The id of the gear item the attack is linked to (state/itemLink.ts).
    item: text(),
    roll: optionalGroup({
        ...rollColumns(MELEE_ROLL_COLUMNS),
        extra1: rollExtra,
        extra2: rollExtra,
        testOption: openSelect(),
    }),
});

const gearArmourLocations = group({
    head: text(),
    torso: text(),
    arms: text(),
    legs: text(),
});

/** A modification of armour: its weight counts with the item's, its entries while the item is equipped. */
export const gearMod = group({
    name: text(),
    weight: number(),
    description: textarea(),
    entries: conditionEntries,
});

/** A modification of a weapon: its weight counts with the item's. */
export const gearWeaponMod = group({
    name: text(),
    weight: number(),
    description: textarea(),
});

export const gearItem = group({
    name: text(),
    quality: select(QUALITIES, "Common"),
    weight: number(),
    gearType: select(GEAR_TYPES, ""),
    carried: checkbox({ initial: true }),
    equipped: checkbox(),
    // Rendered for every item, the fieldset is hidden unless the type is armour.
    armour: group({
        ap: gearArmourLocations,
        superAp: gearArmourLocations,
        special: text(),
        mods: grid(gearMod, 1),
    }),
    // As the armour: shown while the type is weapon. Attacks link to the item by its id.
    weapon: group({
        mods: grid(gearWeaponMod, 1),
    }),
    entries: conditionEntries,
    description: textarea(),
});

/**
 * The material of a gear item (Pathfinder Crusade, state/materials.ts): the
 * pick copies its numbers from the collection, so the sheet computes without
 * the rulebook data. The factors of 0 the server leaves out read as 1.
 */
export const gearMaterial = group({
    name: text(),
    weightFactor: number(1, { emptyAsDefault: true }),
    capacityFactor: number(1, { emptyAsDefault: true }),
    durability: number(),
    ap: number(),
    pen: number(),
    short: text(),
    special: textarea(),
    entries: conditionEntries,
});

/** A level of an enchantment as the collection has it; choosing it copies it to the enchantment. */
export const gearEnchantmentLevel = group({
    capacity: number(),
    text: textarea(),
    special: text(),
    // 0 is weightless (Feather): not emptyAsDefault.
    weightFactor: number(1),
    entries: conditionEntries,
});

/**
 * An enchantment of a gear item (Pathfinder Crusade, state/enchantments.ts).
 * The pick keeps its levels, so a level is chosen without the rulebook data;
 * the chosen one is copied to the fields after `level`, which are what counts
 * and can be edited. An own enchantment has no levels and its own capacity.
 */
export const gearEnchantment = group({
    name: text(),
    levels: grid(gearEnchantmentLevel, 1),
    level: text(),
    capacity: number(),
    weightFactor: number(1),
    description: textarea(),
    special: text(),
    entries: conditionEntries,
});

/** What a gear item of Pathfinder Crusade has besides the shared fields: its material, inlay gem, Broken and enchantments. */
export const gearMaterialFields = {
    material: gearMaterial,
    inlay: select(["", ...INLAY_GEMS.map(g => g.name)], ""),
    broken: checkbox(),
    enchantments: grid(gearEnchantment, 1),
};

export const cyberneticImplant = group({
    name: text(),
    quality: select(QUALITIES, "Common"),
    entries: conditionEntries,
    description: textarea(),
});

// Devotion, of a kind that has it (StatSet.devotion): an advancement allied to the
// character's alignment costs less, a hostile one more (state/itemComputeds.ts).
const devotionOf = <F extends Fields>(stats: StatSet, fields: F): Partial<F> => (stats.devotion ? fields : {});

const experienceItemOf = (stats: StatSet) => group({
    name: text(),
    computedCost: computed(),
    type: select(EXPERIENCE_TYPES),
    experienceCost: number(),
    // A kind that prices Power Rating by its table buys it up to PR 10.
    level: select(stats.prCost ? [...new Set([...EXPERIENCE_LEVELS, ...optionValues(POWER_RATING_LEVELS)])] : EXPERIENCE_LEVELS),
    aptitudes: text(),
    ...devotionOf(stats, { alliedTo: text(), hostileTo: text() }),
});

/**
 * What the attacks or powers of a block can be tested on: a characteristic or
 * a skill (state/testOptions.ts), and the characteristic the skill is tested
 * on instead of its own.
 */
const testOption = (stats: StatSet) => group({
    base: openSelect("W"),
    characteristic: select(["", ...stats.skillCharacteristics], ""),
});

const powerProfile = {
    weaponRange: text(),
    damage: text(),
    damageMods: weaponMods,
    pen: text(),
    penMods: weaponMods,
    damageType: select(DAMAGE_TYPES),
    rofSingle: text(),
    rofShort: text(),
    rofLong: text(),
    special: text(),
    effect: textarea(),
} satisfies Fields;

export const psychicPower = group({
    name: text(),
    subtypes: text(),
    range: text(),
    psychotest: text(),
    action: text(),
    sustained: text(),
    ...powerProfile,
    roll: optionalGroup({
        // The id of one of the block's testOptions.
        testOption: openSelect(),
        modifier: number(),
        effectivePR: number(),
        kickPR: number(),
        safe: checkbox(),
        extra1: rollExtra,
        extra2: rollExtra,
    }),
    cast: group({
        pr: number(),
        kick: number(),
        safe: checkbox(),
        // "pushed", "doubles", "99" or "".
        phenomena: text(),
        requestId: text(),
    }),
    sustain: group({
        copies: number(),
        pr: number(),
        free: checkbox(),
    }),
    ignoreTprPenalty: checkbox(),
    phenomenaMod: number(),
});

/** A modifier of a resource stat; its name is the source, as an implant or talent. */
export const resourceMod = group({
    name: text(),
    expr: text(),
    enabled: checkbox({ initial: true }),
});

/** A modifier of what the Processes cost a turn, in cognition or energy. */
export const processMod = group({
    name: text(),
    expr: text(),
    resource: select(RESOURCES),
    enabled: checkbox({ initial: true }),
});

/** A value of cognition, energy or mana: a base expression, empty for the default of the rules (state/tech.ts), and modifiers. */
const resourceStat = group({
    base: text(),
    mods: grid(resourceMod, 1),
});

export const phenomenaMod = group({
    name: text(),
    value: number(),
    enabled: checkbox({ initial: true }),
});

export const techPower = group({
    name: text(),
    subtypes: text(),
    range: text(),
    implants: text(),
    price: text(),
    process: text(),
    test: text(),
    action: text(),
    ...powerProfile,
    roll: optionalGroup({
        testOption: openSelect(),
        modifier: number(),
        x: number(),
        extra1: rollExtra,
        extra2: rollExtra,
    }),
    inProcess: group({
        copies: number(),
        x: number(),
    }),
    // The compilations of a Litany (X), each a Process of ½X ⚙ until used.
    compiled: number(),
});

// ─── Blocks ──────────────────────────────────────────────────────────────────

const skillRow = (stats: StatSet, row: SkillRow, editableName: boolean) => group({
    ...(editableName && { name: text() }),
    characteristic: select(stats.skillCharacteristics, row.def),
    plus0: checkbox(),
    plus10: checkbox(),
    plus20: checkbox(),
    plus30: checkbox(),
    miscBonus: number(),
    difficulty: computed(),
});

const bodyPart = group({
    armourValue: number(),
    extra1Name: text(),
    extra1Value: number(),
    extra2Name: text(),
    extra2Value: number(),
    superArmour: number(),
});

const list = <I extends Parameters<typeof grid>[0]>(item: I, columns: number) => group({ list: grid(item, columns) });

const skillTable = (stats: StatSet, rows: readonly SkillRow[], editableName: boolean) =>
    group(fromEntries(rows.map(s => s.key), key => skillRow(stats, rows.find(s => s.key === key)!, editableName)));

// The characteristics and skills each kind's schema was made of (statsOfSchema).
const statSets = new WeakMap<GroupSpec, StatSet>();

/** The characteristics and skills `schema` was made of; null for a schema not made by sheetSchemaOf. */
export const statsOfSchema = (schema: GroupSpec): StatSet | null => statSets.get(schema) ?? null;

function withStats<S extends GroupSpec>(schema: S, stats: StatSet | null): S {
    if (stats) statSets.set(schema, stats);
    return schema;
}

/** The schema of a sheet kind with the characteristics and skills of `stats`. */
export const sheetSchemaOf = (stats: StatSet) => withStats(group({
    characterInfo: group({
        characterName: text(),
        archetype: text(),
        race: text(),
        warbandName: text(),
        age: text(),
        homeworld: text(),
        origin: text(),
        pride: text(),
        disgrace: text(),
        motivation: text(),
    }),

    characteristics: group(fromEntries(stats.characteristics.map(c => c.key), () => group({
        value: text(),
        unnatural: text(),
        calculatedValue: computed(),
        calculatedUnnatural: computed(),
        rollBonus: computed(),
        valueForRolls: computed(),
        bonusSuccesses: computed(),
    }))),

    conditions: list(condition, 2),

    skillsLeft: skillTable(stats, stats.skillsLeft, false),
    skillsRight: skillTable(stats, stats.skillsRight, true),
    customSkills: list(customSkill(stats), 1),

    notes: list(namedDescription, 1),

    infamyPoints: group({
        infamyMax: number(),
        infamyCur: number(),
        infamyTemp: number(),
    }),

    fatigue: group({
        fatigueCur: number(),
        threshold: resourceStat,
        fatigueMode: select(FATIGUE_MODES),
    }),

    resourceTrackers: list(resourceTracker, 2),

    initiative: group({
        dice: text(),
        ...fromEntries(INITIATIVE_BONUSES.filter(b => stats.characteristics.some(c => c.key === b.characteristic)).map(b => b.field),
            () => checkbox()),
        flatBonus: number(),
        lastInitiative: hidden("0"),
        conditionBonus: computed(),
        modifier: computed(),
        initiative: computed<string>(),
    }),

    size: select(SIZE_OPTIONS, "0"),

    movement: group({ modes: grid(movementMode, 1) }),

    armour: group({
        ...fromEntries(BODY_PARTS.map(p => p.key), () => bodyPart),
        woundsMax: number(),
        woundsCur: number(),
        daemonicValue: number(),
        naturalArmourValue: number(),
        machineValue: number(),
        otherArmourValue: number(),
    }),

    powerShields: list(powerShield, 1),
    rangedAttacks: group({ list: grid(rangedAttack, 1), testOptions: grid(testOption(stats), 1) }),
    meleeAttacks: group({ list: grid(meleeAttack, 1), testOptions: grid(testOption(stats), 1), stance: select(MELEE_STANCES, "") }),
    traits: list(namedDescription, 3),
    talents: list(namedDescription, 3),

    carryWeightAndEncumbrance: group({
        carryWeightBase: number(),
        encumbrance: computed(),
        // Inputs, but state/computed.ts replaces their signals. Out of the
        // table they read as words ("too strong to hold!").
        carryWeight: computed<number | string>(),
        liftWeight: computed<number | string>(),
        pushWeight: computed<number | string>(),
    }),

    gear: list(gearItem, 3),
    cybernetics: list(cyberneticImplant, 3),

    experience: group({
        ...devotionOf(stats, { useDevotion: checkbox(), alignment: select(ALIGNMENTS) }),
        useAptitudes: checkbox(),
        aptitudes: text(),
        experienceTotal: number(),
        experienceSpent: computed(),
        experienceRemaining: computed(),
        experienceLog: grid(experienceItemOf(stats), 3),
    }),

    mutations: list(namedDescription, 1),
    mentalDisorders: group({
        insanityPoints: number(),
        list: grid(namedDescription, 1),
    }),
    diseases: list(namedDescription, 1),

    psykana: group({
        psykanaType: select(stats.psykanaTypes),
        maxPush: number(),
        basePR: number(),
        sustainedPowers: number(),
        // An input, but state/computed.ts replaces its signal.
        effectivePR: computed(),
        testOptions: grid(testOption(stats), 1),
        tabs: grid(group({
            name: text(),
            powers: grid(psychicPower, 2),
        }), 1),
        lastCastPower: text(),
        sustainPenalty: number(10),
        phenomenaMods: grid(phenomenaMod, 1),
    }),

    technoArcana: group({
        currentCognition: number(),
        cognitionMax: resourceStat,
        cognitionRestore: resourceStat,
        currentEnergy: number(),
        energyMax: resourceStat,
        energyRestore: resourceStat,
        compensationRoll: group({
            modifier: number(),
            extra1: rollExtra,
            extra2: rollExtra,
        }),
        testOptions: grid(testOption(stats), 1),
        tabs: grid(group({
            name: text(),
            powers: grid(techPower, 2),
        }), 1),
        processCost: group({
            mods: grid(processMod, 1),
        }),
        compensation: group({
            // The item id of the power.
            power: text(),
            x: number(),
            energy: number(),
            fatigue: number(),
        }),
    }),

    settings: group({
        psykana: group({
            sustained: checkbox({ default: true }),
            cycle: checkbox({ default: true }),
            phenomena: checkbox({ default: true }),
            noticeSeen: checkbox(),
        }),
        technoArcana: group({
            price: checkbox({ default: true }),
            processes: checkbox({ default: true }),
            hardware: checkbox({ default: true }),
        }),
        meleeAttacks: group({
            // The stance buttons are shown (Stances.tsx); hidden until ▾ shows them.
            stances: checkbox(),
        }),
    }),
}), stats);

export const sheetSchema = sheetSchemaOf(BLACK_CRUSADE_STATS);

/**
 * `schema` with the blocks a kind has alone, the rules of its psykana it
 * adds under the ⚙ (settings.psykana) and the fields of its spells and their
 * rolls. A sheet of another kind has none of them: its signals and content
 * stay without.
 */
export function withOwnFields(schema: SheetSchema, { blocks = {}, psykanaRules = {}, powerFields = {}, rollFields = {}, gearFields = {} }: {
    blocks?: Fields;
    psykanaRules?: Fields;
    /** Fields of the gear item, in gear.list.items. */
    gearFields?: Fields;
    /** Fields of the psychic power item, in psykana.tabs.items.powers. */
    powerFields?: Fields;
    /** Fields of the roll of the psychic power item. */
    rollFields?: Fields;
}): GroupSpec {
    const { settings, psykana } = schema.fields;
    const tabs = psykana.fields.tabs;
    const powers = tabs.item.fields.powers;
    const power = powers.item.fields;
    const roll = optionalGroup({ ...power.roll.fields, ...rollFields });
    const gear = schema.fields.gear.fields.list;
    return withStats(group({
        ...schema.fields,
        ...blocks,
        gear: group({ list: grid(group({ ...gear.item.fields, ...gearFields }), gear.columns) }),
        psykana: group({
            ...psykana.fields,
            tabs: grid(group({ ...tabs.item.fields, powers: grid(group({ ...power, roll, ...powerFields }), powers.columns) }), tabs.columns),
        }),
        settings: group({ ...settings.fields, psykana: group({ ...settings.fields.psykana.fields, ...psykanaRules }) }),
    }), statsOfSchema(schema));
}

/** The mana of Pathfinder Crusade (state/mana.ts): what is left and the maximum, the trait Caster's; also the pool of Arts spells. */
export const mana = group({
    current: number(),
    max: resourceStat,
});

/** The coins of Pathfinder Crusade (state/coins.ts), by metal, and whether their weight counts. */
export const coins = group({
    pp: number(),
    gp: number(),
    sp: number(),
    cp: number(),
    countWeight: checkbox({ default: true }),
});

export type SheetSchema = typeof sheetSchema;

/** Sheet content after normalizeSheet: every field present, typed as its control reads it. */
export type SheetState = Infer<SheetSchema>;

/** The signals of a sheet (state/state.ts createState), with the computed outputs attached. */
export type SheetSignals = SignalsOf<SheetSchema>;
