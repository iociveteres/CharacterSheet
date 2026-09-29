// The sheet schema: every block and item of the sheet (ui/static/js/sheet/blocks).
// Both sheet kinds render the same layout, so they share it.

import {
    ALIGNMENTS, AP_TYPES, BODY_PARTS, CHARACTERISTICS, CHARACTERISTIC_KEYS, DAMAGE_TYPES,
    ENTRY_TYPES, EXPERIENCE_LEVELS, EXPERIENCE_TYPES, FATIGUE_MODES, GEAR_TYPES, INITIATIVE_BONUSES,
    MELEE_BASE_SELECTS, MELEE_GROUPS, MELEE_PROFILES, POWER_SHIELD_NATURES, POWER_SHIELD_TYPES, PSYKANA_TYPES,
    RANGED_BASE_SELECTS, RANGED_CLASSES, ROLL_DOMAINS, ROLL_DOMAIN_MODES, SHIELD_ARMS,
    SHIELD_SUBTYPES, SIZE_OPTIONS, SKILL_CHARACTERISTICS, SKILLS_LEFT, SKILLS_RIGHT, modifierField, optionValue, type Option, type SkillRow,
    MELEE_ROLL_COLUMNS, RANGED_ROLL_COLUMNS, type RollColumn,
} from "./constants";
import {
    checkbox, computed, grid, group, hidden, number, openSelect, optionalGroup, radio, select, text, textarea,
    type Fields, type Infer, type SignalsOf,
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
    domains: group(fromEntries(ROLL_DOMAINS.map(d => d.value), () => checkbox())),
});

const conditionEntries = grid(conditionEntry, 1);

export const condition = group({
    enabled: checkbox({ initial: true }),
    name: text(),
    stacks: number(0, { initial: 1 }),
    entries: conditionEntries,
});

export const customSkill = group({
    name: text(),
    characteristic: select(CHARACTERISTIC_KEYS),
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
    upgrades: text(),
    description: textarea(),
    roll: optionalGroup({
        ...rollColumns(RANGED_ROLL_COLUMNS),
        extra1: rollExtra,
        extra2: rollExtra,
        baseSelect: select(RANGED_BASE_SELECTS),
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
    balance: text(),
    upgrades: text(),
    shield: group({
        subtype: select(SHIELD_SUBTYPES),
        ap: number(),
        defenseSectors: text(),
        arm: select(SHIELD_ARMS),
        equipped: checkbox(),
        defensive: checkbox(),
    }),
    tabs: grid(meleeProfile, 1),
    description: textarea(),
    roll: optionalGroup({
        ...rollColumns(MELEE_ROLL_COLUMNS),
        extra1: rollExtra,
        extra2: rollExtra,
        baseSelect: select(MELEE_BASE_SELECTS),
    }),
});

const gearArmourLocations = group({
    head: text(),
    torso: text(),
    arms: text(),
    legs: text(),
});

export const gearItem = group({
    name: text(),
    weight: number(),
    gearType: select(GEAR_TYPES, ""),
    carried: checkbox({ initial: true }),
    equipped: checkbox(),
    // Rendered for every item, the fieldset is hidden unless the type is armour.
    armour: group({
        ap: gearArmourLocations,
        superAp: gearArmourLocations,
        upgrades: text(),
        special: text(),
    }),
    entries: conditionEntries,
    description: textarea(),
});

export const cyberneticImplant = group({
    name: text(),
    entries: conditionEntries,
    description: textarea(),
});

export const experienceItem = group({
    name: text(),
    computedCost: computed(),
    type: select(EXPERIENCE_TYPES),
    experienceCost: number(),
    level: select(EXPERIENCE_LEVELS),
    aptitudes: text(),
    alliedTo: text(),
    hostileTo: text(),
});

/**
 * What the powers of a block can be tested on: a characteristic or a skill
 * (state/testOptions.ts), and the characteristic the skill is tested on
 * instead of its own.
 */
export const testOption = group({
    base: openSelect("W"),
    characteristic: select(["", ...SKILL_CHARACTERISTICS], ""),
});

const powerProfile = {
    weaponRange: text(),
    damage: text(),
    pen: text(),
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
    damageMods: weaponMods,
    penMods: weaponMods,
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
    }),
    ignoreTprPenalty: checkbox(),
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
        extra1: rollExtra,
        extra2: rollExtra,
    }),
});

// ─── Blocks ──────────────────────────────────────────────────────────────────

const skillRow = (row: SkillRow, editableName: boolean) => group({
    ...(editableName && { name: text() }),
    characteristic: select(SKILL_CHARACTERISTICS, row.def),
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

export const sheetSchema = group({
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

    characteristics: group(fromEntries(CHARACTERISTICS.map(c => c.key), () => group({
        value: text(),
        unnatural: text(),
        calculatedValue: computed(),
        calculatedUnnatural: computed(),
        rollBonus: computed(),
        valueForRolls: computed(),
        bonusSuccesses: computed(),
    }))),

    conditions: list(condition, 2),

    skillsLeft: group(fromEntries(SKILLS_LEFT.map(s => s.key), key =>
        skillRow(SKILLS_LEFT.find(s => s.key === key)!, false))),
    skillsRight: group(fromEntries(SKILLS_RIGHT.map(s => s.key), key =>
        skillRow(SKILLS_RIGHT.find(s => s.key === key)!, true))),
    customSkills: list(customSkill, 1),

    notes: list(namedDescription, 1),

    infamyPoints: group({
        infamyMax: number(),
        infamyCur: number(),
        infamyTemp: number(),
    }),

    fatigue: group({
        fatigueCur: number(),
        fatigueMax: number(),
        fatigueMode: select(FATIGUE_MODES),
    }),

    resourceTrackers: list(resourceTracker, 2),

    initiative: group({
        dice: text(),
        ...fromEntries(INITIATIVE_BONUSES.map(b => b.field), () => checkbox()),
        flatBonus: number(),
        lastInitiative: hidden("0"),
        conditionBonus: computed(),
        modifier: computed(),
        initiative: computed<string>(),
    }),

    size: select(SIZE_OPTIONS, "0"),

    movement: group({
        moveHalf: computed(),
        moveFull: computed(),
        moveCharge: computed(),
        moveRun: computed(),
        bonus: number(),
        // The template shows these defaults for 0.
        fullMult: number(2, { emptyAsDefault: true }),
        chargeMult: number(3, { emptyAsDefault: true }),
        runMult: number(6, { emptyAsDefault: true }),
    }),

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
    rangedAttacks: list(rangedAttack, 1),
    meleeAttacks: list(meleeAttack, 1),
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
        useDevotion: checkbox(),
        alignment: select(ALIGNMENTS),
        useAptitudes: checkbox(),
        aptitudes: text(),
        experienceTotal: number(),
        experienceSpent: computed(),
        experienceRemaining: computed(),
        experienceLog: grid(experienceItem, 3),
    }),

    mutations: list(namedDescription, 1),
    mentalDisorders: group({
        insanityPoints: number(),
        list: grid(namedDescription, 1),
    }),
    diseases: list(namedDescription, 1),

    psykana: group({
        psykanaType: select(PSYKANA_TYPES),
        maxPush: number(),
        basePR: number(),
        sustainedPowers: number(),
        // An input, but state/computed.ts replaces its signal.
        effectivePR: computed(),
        testOptions: grid(testOption, 1),
        tabs: grid(group({
            name: text(),
            powers: grid(psychicPower, 2),
        }), 1),
    }),

    technoArcana: group({
        currentCognition: number(),
        maxCognition: number(),
        restoreCognition: number(),
        currentEnergy: number(),
        maxEnergy: number(),
        compensationRoll: group({
            modifier: number(),
            extra1: rollExtra,
            extra2: rollExtra,
        }),
        testOptions: grid(testOption, 1),
        tabs: grid(group({
            name: text(),
            powers: grid(techPower, 2),
        }), 1),
    }),
});

export type SheetSchema = typeof sheetSchema;

/** Sheet content after normalizeSheet: every field present, typed as its control reads it. */
export type SheetState = Infer<SheetSchema>;

/** The signals of the sheet (characterState), with the computed outputs attached. */
export type SheetSignals = SignalsOf<SheetSchema>;
