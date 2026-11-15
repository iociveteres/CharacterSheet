// The computeds a kind attaches to its state: the index of entries, which
// reads conditions, gear, implants and the stance, and those of each topic.
import { computed } from "@preact/signals-core";
import { attachCharacteristicComputeds } from "../characteristics/characteristicComputeds";
import { attachCombatComputeds } from "../combat/combatComputeds";
import { attachGearComputeds } from "../gear/gearComputeds";
import { gearItemEntries } from "../gear/gearItem";
import { attachMagicComputeds } from "../magic/psychic";
import { setEntryIndex, type Entry, type EntryRef } from "../modifiers/entries";
import { attachProfileComputeds } from "../profile/profileComputeds";
import { stanceEntries } from "../weapons/stanceRules";
import type { SheetSignals } from "../schema/sheet";

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

export function attachComputeds(state: SheetSignals): void {
    setEntryIndex(state, computed(() => buildEntryIndex(state)));
    attachCharacteristicComputeds(state);
    attachCombatComputeds(state);
    attachGearComputeds(state);
    attachMagicComputeds(state);
    attachProfileComputeds(state);
}
