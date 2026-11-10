// The entries of conditions, gear, implants and the stance, by entry type.
// computed.ts builds each sheet's index from all their sources; the rules
// read it here without importing those sources.
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import { parseCharacteristics, resolveStackExpr, type CharacteristicSet } from "../system";
import type { SheetSignals } from "../schema/sheet";
import type { GearItem } from "../gear/materialRules";

/** An entry of a condition, gear item or implant. */
export type Entry = SheetSignals["conditions"]["list"]["items"][string]["entries"]["items"][string];
type EntryField = Exclude<keyof Entry, "type" | "domains">;

/** An entry that counts, with the stacks of its condition and what it belongs to. */
export interface EntryRef {
    entry: Entry;
    stacks: number;
    source: { name: Signal<string> };
    /** The gear item of an entry of the item, its material, mods or enchantments; none for a condition, implant or stance. */
    item?: GearItem;
}

// The index of each sheet's state, which attachComputeds builds.
const entryIndexes = new WeakMap<SheetSignals, ReadonlySignal<Map<string, EntryRef[]>>>();

export function setEntryIndex(state: SheetSignals, index: ReadonlySignal<Map<string, EntryRef[]>>): void {
    entryIndexes.set(state, index);
}

/** All entries of a given type, optionally filtered. */
export function collectEntries(state: SheetSignals, entryType: string, filter: ((entry: Entry) => boolean) | null = null): readonly EntryRef[] {
    const all = entryIndexes.get(state)?.value.get(entryType) ?? [];
    return filter ? all.filter(({ entry }) => filter(entry)) : all;
}

/**
 * Sum a single numeric entry field across all matching entries.
 */
export function sumEntryField(state: SheetSignals, entryType: string, field: EntryField, filter: ((entry: Entry) => boolean) | null = null): number {
    return collectEntries(state, entryType, filter)
        .reduce((acc, { entry, stacks }) =>
            acc + resolveStackExpr(entry[field]?.value, stacks), 0);
}

// Any in an entry's name is the rulebook's "all tests": not Infamy and
// Corruption, nor Fate of Pathfinder Crusade, which takes Infamy's place.
const OUTSIDE_ANY = new Set(['Inf', 'Cor', 'Fa']);

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
