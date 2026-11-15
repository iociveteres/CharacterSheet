// The entries of conditions, gear, implants and the stance, by entry type.
// kinds/computed.ts builds each sheet's index from all their sources; the rules
// read it here without importing those sources.
import { computed, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { parseCharacteristics, resolveStackExpr, type CharacteristicSet } from "./entryValues";
import type { SheetSignals } from "../schema/sheet";
import type { GearItem } from "../schema/sheet";

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

// The index is rebuilt whenever any source changes, e.g. an unequipped item is
// added; readers go through one computed per entry type, which keeps its array
// while the entries of its type stay the same, so they don't wake up.
const entriesByType = new WeakMap<SheetSignals, Map<string, ReadonlySignal<readonly EntryRef[]>>>();

const NO_ENTRIES: readonly EntryRef[] = Object.freeze([]);

export function setEntryIndex(state: SheetSignals, index: ReadonlySignal<Map<string, EntryRef[]>>): void {
    entryIndexes.set(state, index);
    entriesByType.delete(state);
}

const sameRef = (a: EntryRef, b: EntryRef) =>
    a.entry === b.entry && a.item === b.item && a.source === b.source && a.stacks === b.stacks;

function entriesOfType(state: SheetSignals, index: ReadonlySignal<Map<string, EntryRef[]>>, entryType: string): readonly EntryRef[] {
    let byType = entriesByType.get(state);
    if (!byType) {
        byType = new Map();
        entriesByType.set(state, byType);
    }
    let entries = byType.get(entryType);
    if (!entries) {
        let prev = NO_ENTRIES;
        entries = computed(() => {
            const next = index.value.get(entryType) ?? NO_ENTRIES;
            if (next.length === prev.length && next.every((ref, i) => sameRef(ref, prev[i]))) return prev;
            return (prev = next);
        });
        byType.set(entryType, entries);
    }
    return entries.value;
}

/** All entries of a given type, optionally filtered. */
export function collectEntries(state: SheetSignals, entryType: string, filter: ((entry: Entry) => boolean) | null = null): readonly EntryRef[] {
    const index = entryIndexes.get(state);
    // Without one every rule would count no entries and nothing would fail.
    if (__DEV__ && !index) throw new Error("No entry index: attach the kind's computeds to the state");
    const all = index ? entriesOfType(state, index, entryType) : NO_ENTRIES;
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
