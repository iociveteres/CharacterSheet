// The caps of a characteristic (char_cap entries, as Char. Cap A 35 of a
// rulebook armour) and what raises them (char_cap_bonus, Cap Bonus): a Cap
// Bonus of a gear item, its material, mods or enchantments raises only that
// item's caps (gear/itemCaps.ts), one anywhere else every cap. The lowest cap counts
// (kinds/computed.ts calculatedValue).
import type { SheetSignals } from "../schema/sheet";
import { resolveStackExpr } from "../modifiers/entryValues";
import { signed } from "../components/format";
import { characteristicsOf, collectEntries, type Entry, type EntryRef } from "../modifiers/entries";

export interface CapRaise {
    source: string;
    value: number;
}

export interface Cap {
    ref: EntryRef;
    /** The entry's own cap. */
    base: number;
    raises: CapRaise[];
    total: number;
}

const sourceName = ({ source }: EntryRef) => String(source.name?.value || "—");

/** Whether an entry names the characteristic `key`. */
export const namesCharacteristic = (state: SheetSignals, key: string) => (e: Entry) => characteristicsOf(state, e.name?.value).keys.has(key);

/** The cap of `ref` raised by those of `bonuses` that reach it: its item's, then the character-wide ones. Null for no cap (0 or blank). */
export function raisedCap(ref: EntryRef, bonuses: readonly EntryRef[]): Cap | null {
    const base = resolveStackExpr(ref.entry.cap?.value, ref.stacks);
    if (base <= 0) return null;
    const own = ref.item ? bonuses.filter(b => b.item === ref.item) : [];
    const raises = [...own, ...bonuses.filter(b => !b.item)]
        .map(b => ({ source: sourceName(b), value: resolveStackExpr(b.entry.capBonus?.value, b.stacks) }))
        .filter(r => r.value !== 0);
    const total = Math.max(0, raises.reduce((sum, r) => sum + r.value, base));
    return { ref, base, raises, total };
}

/** The caps of the characteristic `key` that count, raised. */
export function characteristicCaps(state: SheetSignals, key: string): Cap[] {
    const caps = collectEntries(state, "char_cap", namesCharacteristic(state, key));
    if (!caps.length) return [];
    const bonuses = collectEntries(state, "char_cap_bonus", namesCharacteristic(state, key));
    return caps.flatMap(ref => raisedCap(ref, bonuses) ?? []);
}

/** The cap that counts: the lowest. */
export const lowestCap = (caps: readonly Cap[]): Cap | null =>
    caps.reduce<Cap | null>((low, cap) => (!low || cap.total < low.total ? cap : low), null);

/** "35 Mail Hauberk", "+20 Mithral", "= 55": how the cap is made up, for a title. */
export function capLines(cap: Cap): string[] {
    return [
        `${cap.base} ${sourceName(cap.ref)}`,
        ...cap.raises.map(r => `${signed(r.value)} ${r.source}`),
        `= ${cap.total}`,
    ];
}
