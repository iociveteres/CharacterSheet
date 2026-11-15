// The computeds of characteristics and skills: final values with overrides,
// bonuses and caps, and the difficulty of standard and custom skills.
import { computed } from "@preact/signals-core";
import { calculateBonusSuccesses } from "./characteristicRules";
import { characteristicCaps, lowestCap } from "./caps";
import { fatiguePenalty, skillDifficulty, skillRowName } from "./difficulty";
import { characteristicsOf, collectEntries, type Entry } from "../modifiers/entries";
import { resolveStackExpr } from "../modifiers/entryValues";
import { addItemComputeds } from "../core/state";
import type { SheetSignals } from "../schema/sheet";

type Characteristic = SheetSignals["characteristics"][string];
type CustomSkill = SheetSignals["customSkills"]["list"]["items"][string];

function attachCharacteristic(state: SheetSignals, key: string) {
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

function attachStandardSkill(state: SheetSignals, skillId: string, mapName: 'skillsLeft' | 'skillsRight') {
    const sk = state[mapName]?.[skillId];
    if (!sk || sk.difficulty) return;

    sk.difficulty = computed(() =>
        skillDifficulty(state, sk, sk.characteristic?.value || "WS", skillRowName(sk, skillId)));
}

function attachCustomSkill(state: SheetSignals, sk: CustomSkill) {
    sk.difficulty = computed(() => skillDifficulty(state, sk, sk.characteristic?.value || "WS", sk.name?.value));
}

export function attachCharacteristicComputeds(state: SheetSignals): void {
    for (const key of Object.keys(state.characteristics ?? {})) attachCharacteristic(state, key);
    for (const id of Object.keys(state.skillsLeft ?? {})) attachStandardSkill(state, id, 'skillsLeft');
    for (const id of Object.keys(state.skillsRight ?? {})) attachStandardSkill(state, id, 'skillsRight');
    addItemComputeds(state, { 'customSkills.list.items': attachCustomSkill });
}
