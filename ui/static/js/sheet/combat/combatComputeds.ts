// The computeds of combat: the initiative modifier and roll (initiative.ts
// reads them) and the distances of each movement mode.
import { computed } from "@preact/signals-core";
import { MOVE_COLUMNS, modeDistance } from "./movement";
import { characteristicBonus } from "../characteristics/characteristicRules";
import { sumEntryField } from "../modifiers/entries";
import { signed } from "../components/format";
import { addItemComputeds } from "../core/state";
import { INITIATIVE_BONUSES } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

type MovementMode = SheetSignals["movement"]["modes"]["items"][string];

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;

/** "2d10+3" gives { dice: "2d10", bonus: 3 }; anything else is its own dice with no bonus. */
function parseDiceBonus(diceStr: string | null | undefined): { dice: string; bonus: number } {
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
function attachInitiative(state: SheetSignals) {
    const ini = state.initiative;
    ini.conditionBonus = computed(() => sumEntryField(state, 'initiative_bonus', 'initiativeBonus'));

    ini.modifier = computed(() => {
        const { bonus: diceBonus } = parseDiceBonus(ini.dice?.value);

        let charTotal = 0;
        for (const { characteristic: key, field } of INITIATIVE_BONUSES) {
            if (!ini[field]?.value) continue;
            charTotal += characteristicBonus(state, key);
        }

        return charTotal + num(ini.flatBonus) + diceBonus + num(ini.conditionBonus);
    });

    ini.initiative = computed(() => {
        const { dice } = parseDiceBonus(ini.dice?.value);
        const total = ini.modifier.value;
        return total === 0 ? dice : `${dice}${signed(total)}`;
    });
}

function attachMovementMode(state: SheetSignals, mode: MovementMode, path: string) {
    for (const column of MOVE_COLUMNS) mode[column.key] = computed(() => modeDistance(state, path, column));
}

export function attachCombatComputeds(state: SheetSignals): void {
    attachInitiative(state);
    addItemComputeds(state, { 'movement.modes.items': attachMovementMode });
}
