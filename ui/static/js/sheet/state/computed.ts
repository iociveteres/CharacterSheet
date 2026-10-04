import { computed, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { attachAllItemComputeds } from "./itemComputeds";
import { sustaining } from "./psychic";
import { characteristicBonus } from "./characteristics";
import {
    calculateSkillAdvancement,
    calculateTestDifficulty,
    calculateBonusSuccesses,
    parseCharacteristics,
    resolveStackExpr,
    normalizeSkillName,
    signed,
    type CharacteristicSet,
} from "../system";
import { INITIATIVE_BONUSES, type RollDomain } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

type Characteristic = SheetSignals["characteristics"][string];
type Initiative = SheetSignals["initiative"];
type SkillRow = SheetSignals["skillsLeft"][string];
type CustomSkill = SheetSignals["customSkills"]["list"]["items"][string];

/** An entry of a condition, gear item or implant. */
export type Entry = SheetSignals["conditions"]["list"]["items"][string]["entries"]["items"][string];
type EntryField = Exclude<keyof Entry, "type" | "domains">;

/** An entry that counts, with the stacks of its condition and what it belongs to. */
export interface EntryRef {
    entry: Entry;
    stacks: number;
    source: { name: Signal<string> };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;


/**
 * Single-pass index over all entry sources, by entry type. Built once as a
 * shared computed so all consumers (11 characteristics, skills, initiative,
 * etc.) share one iteration instead of each doing their own.
 */
function buildEntryIndex(state: SheetSignals): Map<string, EntryRef[]> {
    const index = new Map<string, EntryRef[]>();

    const add = (entry: Entry, stacks: number, source: EntryRef['source']) => {
        const type = entry.type?.value;
        if (!type) return;
        let byType = index.get(type);
        if (!byType) { byType = []; index.set(type, byType); }
        byType.push({ entry, stacks, source });
    };

    for (const cond of Object.values(state.conditions?.list?.items ?? {})) {
        if (!cond.enabled?.value) continue;
        const stacks = parseInt(String(cond.stacks?.value), 10) || 1;
        for (const entry of Object.values(cond.entries?.items ?? {})) add(entry, stacks, cond);
    }

    for (const item of Object.values(state.gear?.list?.items ?? {})) {
        if (!item.equipped?.value) continue;
        for (const entry of Object.values(item.entries?.items ?? {})) add(entry, 1, item);
    }

    for (const item of Object.values(state.cybernetics?.list?.items ?? {})) {
        for (const entry of Object.values(item.entries?.items ?? {})) add(entry, 1, item);
    }

    return index;
}

// The index of each sheet's state, which attachComputeds builds.
const entryIndexes = new WeakMap<SheetSignals, ReadonlySignal<Map<string, EntryRef[]>>>();

/** All entries of a given type, optionally filtered. */
export function collectEntries(state: SheetSignals, entryType: string, filter: ((entry: Entry) => boolean) | null = null): readonly EntryRef[] {
    const all = entryIndexes.get(state)?.value.get(entryType) ?? [];
    return filter ? all.filter(({ entry }) => filter(entry)) : all;
}

// Any in an entry's name is the rulebook's "all tests": not Infamy and Corruption.
const OUTSIDE_ANY = new Set(['Inf', 'Cor']);

/** Whether Any in an entry's name picks the characteristic `key`. */
export const inAny = (key: string): boolean => !OUTSIDE_ANY.has(key);

// Every characteristic filters the same entries by name, so a name is parsed
// once per sheet. Keyed by the sheet's characteristics, which each load builds
// anew: a sheet of another kind may have other ones.
const characteristicSets = new WeakMap<object, Map<string, CharacteristicSet>>();

/** The characteristics of the sheet that an entry's name picks (see parseCharacteristics). */
export function characteristicsOf(state: SheetSignals, name: string | null | undefined): CharacteristicSet {
    const chars = state.characteristics ?? {};
    let byName = characteristicSets.get(chars);
    if (!byName) {
        byName = new Map();
        characteristicSets.set(chars, byName);
    }
    const key = name ?? '';
    let set = byName.get(key);
    if (!set) {
        // Typing a name parses each of its prefixes: start over rather than keep them all.
        if (byName.size >= 500) byName.clear();
        const keys = Object.keys(chars);
        set = parseCharacteristics(key, keys, keys.filter(inAny));
        byName.set(key, set);
    }
    return set;
}

/**
 * Sum a single numeric entry field across all matching entries.
 */
export function sumEntryField(state: SheetSignals, entryType: string, field: EntryField, filter: ((entry: Entry) => boolean) | null = null): number {
    return collectEntries(state, entryType, filter)
        .reduce((acc, { entry, stacks }) =>
            acc + resolveStackExpr(entry[field]?.value, stacks), 0);
}


// ─── Carry weight tables ──────────────────────────────────────────────────────

const CARRY_WEIGHT_TABLE = [
    0.9, 2.25, 4.5, 9, 18, 27, 36, 45, 56, 67, 78, 90, 112, 225, 337, 450,
    675, 900, 1350, 1800, 2250, 2700, 3150, 3600, 4050, 4500, 4950, 5400,
    5850, 6300, 6750, 7200, 7650, 8100, 8550, 9000, 9450, 9900, 10350,
    10800, 11250, 11700, 12150, 12600, 13050, 13500,
];
const LIFT_WEIGHT_TABLE = [
    2.25, 4.5, 9, 18, 36, 54, 72, 90, 112, 135, 157, 180, 225, 450, 675, 900,
    1350, 1800, 2700, 3600, 4500, 5400, 6300, 7200, 8100, 9000, 9900, 10800,
    11700, 12600, 13500, 14400, 15300, 16200, 17100, 18000, 18900, 19800,
    20700, 21600, 22500, 23400, 24300, 25200, 26100, 27000,
];
const PUSH_WEIGHT_TABLE = [
    4.5, 9, 18, 36, 72, 108, 144, 180, 225, 270, 315, 360, 450, 900, 1350,
    1800, 2700, 3600, 5400, 7200, 9000, 10800, 12600, 14400, 16200, 18000,
    19800, 21600, 23400, 25200, 27000, 28800, 30600, 32400, 34200, 36000,
    37800, 39600, 41400, 43200, 45000, 46800, 48600, 50400, 52200, 54000,
];

// ─── Computed factories ───────────────────────────────────────────────────────

function buildMovementComputed(state: SheetSignals) {
    const conditionBonus = computed(() => sumEntryField(state, 'movement_bonus', 'movementBonus'));

    function halfBase() {
        return characteristicBonus(state, "A") + num(state.size) + num(state.movement?.bonus) + conditionBonus.value;
    }

    return {
        moveHalf: computed(() => Math.max(0, halfBase())),
        moveFull: computed(() => Math.max(0, halfBase() * (num(state.movement?.fullMult) || 2))),
        moveCharge: computed(() => Math.max(0, halfBase() * (num(state.movement?.chargeMult) || 3))),
        moveRun: computed(() => Math.max(0, halfBase() * (num(state.movement?.runMult) || 6))),
    };
}


// ─── Characteristics ──────────────────────────────────────────────────────────

const FATIGUE_ALL = new Set(['WS', 'BS', 'S', 'A', 'I', 'P', 'W', 'F']);
const FATIGUE_MENTAL = new Set(['I', 'P', 'W', 'F']);
const FATIGUE_PHYSICAL = new Set(['WS', 'BS', 'S', 'A']);

function attachCharacteristicComputeds(state: SheetSignals, key: string) {
    const char: Characteristic | undefined = state.characteristics?.[key];
    if (!char) return;

    const charFilter = (e: Entry) => characteristicsOf(state, e.name?.value).keys.has(key);

    // char_override: replaces the permanent value and/or unnatural outright.
    // Value and unnatural are resolved fully independently of each other —
    // they are NOT paired per-entry. One condition can override just the value
    // (e.g. value 60, unnatural left blank) while a separate, unrelated
    // condition overrides just the unnatural (e.g. value left blank, unnatural
    // 4). Each field takes the highest override among entries that set that
    // specific field; an entry with a blank value field simply doesn't
    // participate in the value comparison (and likewise for unnatural).
    const overrideEntry = computed(() => {
        let value: number | null = null;
        let unnatural: number | null = null;

        for (const { entry, stacks } of collectEntries(state, 'char_override', charFilter)) {
            const rawValue = entry.overrideValue?.value;
            if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
                const v = resolveStackExpr(rawValue, stacks);
                if (value === null || v > value) value = v;
            }

            const rawUnnatural = entry.overrideUnnatural?.value;
            if (rawUnnatural !== undefined && rawUnnatural !== null && String(rawUnnatural).trim() !== '') {
                const u = resolveStackExpr(rawUnnatural, stacks);
                if (unnatural === null || u > unnatural) unnatural = u;
            }
        }

        return { value, unnatural };
    });

    char.calculatedValue = computed(() => {
        const override = overrideEntry.value.value;
        const base = override !== null ? override : (parseInt(char.value?.value, 10) || 0);

        let bonus = 0, cap = Infinity;
        for (const { entry, stacks } of collectEntries(state, 'char_bonus', charFilter)) {
            bonus += resolveStackExpr(entry.bonus?.value, stacks);
        }
        for (const { entry, stacks } of collectEntries(state, 'char_cap', charFilter)) {
            const n = resolveStackExpr(entry.cap?.value, stacks);
            if (n > 0) cap = Math.min(cap, n);
        }
        const raw = base + bonus;
        return cap === Infinity ? raw : Math.min(raw, cap);
    });

    char.calculatedUnnatural = computed(() => {
        const override = overrideEntry.value.unnatural;
        const base = override !== null ? override : (parseInt(char.unnatural?.value, 10) || 0);

        return base + collectEntries(state, 'char_bonus', charFilter)
            .reduce((acc, { entry, stacks }) =>
                acc + resolveStackExpr(entry.unnaturalBonus?.value, stacks), 0);
    });

    // An ordinary test counts the entries of all rolls and those "except" some;
    // domainRollBonus adjusts it for a roll of a domain.
    char.rollBonus = computed(() => {
        let total = collectEntries(state, 'roll_bonus', e => charFilter(e) && e.domainMode?.value !== 'only')
            .reduce((acc, { entry, stacks }) =>
                acc + resolveStackExpr(entry.rollBonus?.value, stacks), 0);

        const cur = Number(state.fatigue?.fatigueCur?.value) || 0;
        if (cur > 0) {
            const mode = state.fatigue?.fatigueMode?.value ?? 'all';
            const affected =
                mode === 'mental' ? FATIGUE_MENTAL :
                    mode === 'physical' ? FATIGUE_PHYSICAL :
                        mode === 'nothing' ? null :
                            FATIGUE_ALL;

            if (affected?.has(key)) total -= 10;
        }

        return total;
    });

    char.valueForRolls = computed(() =>
        char.calculatedValue.value + char.rollBonus.value
    );

    char.bonusSuccesses = computed(() =>
        calculateBonusSuccesses(char.calculatedUnnatural.value)
    );
}

/**
 * What a roll of `domain` on the characteristic `charKey` adds to its
 * valueForRolls: the roll_bonus entries of the characteristic "only" for the
 * domain, less those "except" it, which valueForRolls counts.
 */
export function domainRollBonus(state: SheetSignals, charKey: string, domain: RollDomain): number {
    let total = 0;
    for (const { entry, stacks } of collectEntries(state, 'roll_bonus')) {
        const mode = entry.domainMode?.value;
        if (!mode || !entry.domains?.[domain]?.value || !characteristicsOf(state, entry.name?.value).keys.has(charKey)) continue;
        const bonus = resolveStackExpr(entry.rollBonus?.value, stacks);
        total += mode === 'only' ? bonus : -bonus;
    }
    return total;
}

// ─── Initiative ───────────────────────────────────────────────────────────────

/** "2d10+3" gives { dice: "2d10", bonus: 3 }; anything else is its own dice with no bonus. */
export function parseDiceBonus(diceStr: string | null | undefined): { dice: string; bonus: number } {
    const s = (diceStr ?? '').trim();
    const m = s.match(/^([0-9]*d[0-9]+)\s*([+-]\s*\d+)?$/i);
    if (!m) return { dice: s || 'd10', bonus: 0 };
    return {
        dice: m[1],
        bonus: m[2] ? parseInt(m[2].replace(/\s/g, ''), 10) : 0
    };
}

/**
 * The initiative modifier (characteristic bases, flat and dice bonus, entries)
 * and the roll expression, e.g. "d10+7".
 */
function buildInitiativeComputed(state: SheetSignals, ini: Initiative) {
    const modifier = computed(() => {
        const { bonus: diceBonus } = parseDiceBonus(ini.dice?.value);

        let charTotal = 0;
        for (const { characteristic: key, field } of INITIATIVE_BONUSES) {
            if (!ini[field]?.value) continue;
            charTotal += characteristicBonus(state, key);
        }

        return charTotal + num(ini.flatBonus) + diceBonus + num(ini.conditionBonus);
    });

    const roll = computed(() => {
        const { dice } = parseDiceBonus(ini.dice?.value);
        const total = modifier.value;
        return total === 0 ? dice : `${dice}${signed(total)}`;
    });

    return { modifier, roll };
}

function buildCarryWeightComputed(state: SheetSignals) {
    const base = () => num(state.carryWeightAndEncumbrance?.carryWeightBase);
    return {
        carryWeight: computed(() => {
            const b = base();
            if (b > 45) return "too";
            if (b < 0) return "such";
            return CARRY_WEIGHT_TABLE[b];
        }),
        liftWeight: computed(() => {
            const b = base();
            if (b > 45) return "strong";
            if (b < 0) return "a puny";
            return LIFT_WEIGHT_TABLE[b];
        }),
        pushWeight: computed(() => {
            const b = base();
            if (b > 45) return "to hold!";
            if (b < 0) return "weakling!";
            return PUSH_WEIGHT_TABLE[b];
        }),
        encumbrance: computed(() => {
            let total = 0;
            for (const id in (state.gear?.list?.items ?? {})) {
                const item = state.gear.list.items[id];
                if (!item.carried?.value) continue;
                total += Math.round(num(item.weight) * 1000);
            }
            return total / 1000;
        }),
    };
}

function buildExperienceComputed(state: SheetSignals) {
    const spent = computed(() => {
        let total = 0;
        for (const id in (state.experience?.experienceLog?.items ?? {})) {
            total += num(state.experience.experienceLog.items[id]?.computedCost);
        }
        return total;
    });
    return {
        spent,
        remaining: computed(() =>
            num(state.experience?.experienceTotal) - spent.value
        ),
    };
}

// ─── Standard skill computed ──────────────────────────────────────────────────

const SKILL_ADVANCES = ['plus0', 'plus10', 'plus20', 'plus30'] as const;

/**
 * The test difficulty of a skill row or custom skill tested on `charKey`: its
 * advances and misc bonus, and the skill_bonus entries named `name`.
 */
export function skillDifficulty(state: SheetSignals, skill: SkillRow | CustomSkill, charKey: string, name: string | undefined): number {
    const val = state.characteristics?.[charKey]?.valueForRolls?.value ?? 0;
    const advances = SKILL_ADVANCES.filter(key => skill[key]?.value).length;
    const skillName = normalizeSkillName(name);
    const bonus = skillName
        ? sumEntryField(state, 'skill_bonus', 'skillBonus', e => normalizeSkillName(e.name?.value) === skillName)
        : 0;
    return calculateTestDifficulty(val, calculateSkillAdvancement(advances)) + num(skill.miscBonus) + bonus;
}

/** A skill row is named by its row key until the player names it (right-column rows). */
export const skillRowName = (skill: SkillRow, skillId: string): string => skill.name?.value?.trim() || skillId;

function attachStandardSkillComputed(state: SheetSignals, skillId: string, mapName: 'skillsLeft' | 'skillsRight') {
    const sk = state[mapName]?.[skillId];
    if (!sk || sk.difficulty) return;

    sk.difficulty = computed(() =>
        skillDifficulty(state, sk, sk.characteristic?.value || "WS", skillRowName(sk, skillId)));
}


// ─── wireIntoState ────────────────────────────────────────────────────────────
// Builds the sheet-wide computeds on the signals of a sheet and puts them
// into its state, where the blocks read them.

function wireIntoState(state: SheetSignals) {
    entryIndexes.set(state, computed(() => buildEntryIndex(state)));

    Object.assign(state.carryWeightAndEncumbrance, buildCarryWeightComputed(state));

    const experience = buildExperienceComputed(state);
    state.experience.experienceSpent = experience.spent;
    state.experience.experienceRemaining = experience.remaining;

    // The current PR: less the powers marked sustained (psychic.ts), or Sustained Powers as typed.
    state.psykana.effectivePR = computed(() => num(state.psykana?.basePR) - sustaining(state).taken);

    Object.assign(state.movement, buildMovementComputed(state));

    state.initiative.conditionBonus = computed(() => sumEntryField(state, 'initiative_bonus', 'initiativeBonus'));
    const initiative = buildInitiativeComputed(state, state.initiative);
    state.initiative.modifier = initiative.modifier;
    state.initiative.initiative = initiative.roll;
}

// ─── attachComputeds ─────────────────────────────────────────────────────────

export function attachComputeds(state: SheetSignals): void {
    // Characteristics
    for (const key of Object.keys(state.characteristics ?? {})) {
        attachCharacteristicComputeds(state, key);
    }

    // Standard skills
    for (const id of Object.keys(state.skillsLeft ?? {})) attachStandardSkillComputed(state, id, 'skillsLeft');
    for (const id of Object.keys(state.skillsRight ?? {})) attachStandardSkillComputed(state, id, 'skillsRight');

    // Custom skills and advancements
    attachAllItemComputeds(state);

    // Carry weight, experience, PR, movement and initiative
    wireIntoState(state);
}
