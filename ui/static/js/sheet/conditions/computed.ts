// The sheet-wide computeds of a sheet's state: characteristics, skills,
// carry weight, experience, PR, initiative and the index of entries.
import { computed } from "@preact/signals-core";
import { attachAllItemComputeds } from "./itemComputeds";
import { sustaining } from "../state/psychic";
import { characteristicBonus } from "../characteristics/characteristicRules";
import { coinsWeight } from "../gear/coinRules";
import { stanceEntries } from "../weapons/stanceRules";
import { characteristicCaps, lowestCap } from "../characteristics/caps";
import { characteristicsOf, collectEntries, setEntryIndex, sumEntryField, type Entry, type EntryRef } from "./entries";
import { gearItemEntries, gearWeight } from "../gear/gearItem";
import { fatiguePenalty, skillDifficulty, skillRowName } from "../characteristics/difficulty";
import { calculateBonusSuccesses, resolveStackExpr, signed } from "../system";
import { INITIATIVE_BONUSES } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

type Characteristic = SheetSignals["characteristics"][string];
type Initiative = SheetSignals["initiative"];

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;

/**
 * Single-pass index over all entry sources, by entry type. Built once as a
 * shared computed so all consumers (11 characteristics, skills, initiative,
 * etc.) share one iteration instead of each doing their own.
 */
function buildEntryIndex(state: SheetSignals): Map<string, EntryRef[]> {
    const index = new Map<string, EntryRef[]>();

    const push = (ref: EntryRef) => {
        const type = ref.entry.type?.value;
        if (!type) return;
        let byType = index.get(type);
        if (!byType) { byType = []; index.set(type, byType); }
        byType.push(ref);
    };
    const add = (entry: Entry, stacks: number, source: EntryRef['source']) => push({ entry, stacks, source });

    for (const cond of Object.values(state.conditions?.list?.items ?? {})) {
        if (!cond.enabled?.value) continue;
        const stacks = parseInt(String(cond.stacks?.value), 10) || 1;
        for (const entry of Object.values(cond.entries?.items ?? {})) add(entry, stacks, cond);
    }

    for (const item of Object.values(state.gear?.list?.items ?? {})) {
        if (item.equipped?.value) gearItemEntries(item).forEach(push);
    }

    for (const item of Object.values(state.cybernetics?.list?.items ?? {})) {
        for (const entry of Object.values(item.entries?.items ?? {})) add(entry, 1, item);
    }

    const stance = stanceEntries(state);
    for (const entry of stance.entries) add(entry, 1, stance.source);

    return index;
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

// ─── Characteristics ──────────────────────────────────────────────────────────
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

        let bonus = 0;
        for (const { entry, stacks } of collectEntries(state, 'char_bonus', charFilter)) {
            bonus += resolveStackExpr(entry.bonus?.value, stacks);
        }
        const cap = lowestCap(characteristicCaps(state, key));
        const raw = base + bonus;
        return cap ? Math.min(raw, cap.total) : raw;
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
        return collectEntries(state, 'roll_bonus', e => charFilter(e) && e.domainMode?.value !== 'only')
            .reduce((acc, { entry, stacks }) =>
                acc + resolveStackExpr(entry.rollBonus?.value, stacks), 0) - fatiguePenalty(state, key);
    });

    char.valueForRolls = computed(() =>
        char.calculatedValue.value + char.rollBonus.value
    );

    char.bonusSuccesses = computed(() =>
        calculateBonusSuccesses(char.calculatedUnnatural.value)
    );
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
                total += Math.round(gearWeight(item).total * 1000);
            }
            return (total + Math.round(coinsWeight(state) * 1000)) / 1000;
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
    setEntryIndex(state, computed(() => buildEntryIndex(state)));

    Object.assign(state.carryWeightAndEncumbrance, buildCarryWeightComputed(state));

    const experience = buildExperienceComputed(state);
    state.experience.experienceSpent = experience.spent;
    state.experience.experienceRemaining = experience.remaining;

    // The current PR: less the powers marked sustained (psychic.ts), or Sustained Powers as typed.
    state.psykana.effectivePR = computed(() => num(state.psykana?.basePR) - sustaining(state).taken);


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

    // Carry weight, experience, PR and initiative
    wireIntoState(state);
}
