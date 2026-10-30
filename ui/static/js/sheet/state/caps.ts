// The caps of a characteristic (char_cap entries, as Char. Cap A 35 of a
// rulebook armour) and what raises them (char_cap_bonus, Cap Bonus): a Cap
// Bonus of a gear item, its material, mods or enchantments raises only that
// item's caps, one anywhere else every cap. The lowest cap counts
// (state/computed.ts calculatedValue).
import type { SheetSignals } from "../schema/sheet";
import { resolveStackExpr, signed } from "../system";
import { characteristicsOf, collectEntries, gearItemEntries, type Entry, type EntryRef } from "./computed";
import type { GearItem } from "./materials";

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

const names = (state: SheetSignals, key: string) => (e: Entry) => characteristicsOf(state, e.name?.value).keys.has(key);

/** The cap of `ref` raised by those of `bonuses` that reach it: its item's, then the character-wide ones. Null for no cap (0 or blank). */
function raisedCap(ref: EntryRef, bonuses: readonly EntryRef[]): Cap | null {
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
    const caps = collectEntries(state, "char_cap", names(state, key));
    if (!caps.length) return [];
    const bonuses = collectEntries(state, "char_cap_bonus", names(state, key));
    return caps.flatMap(ref => raisedCap(ref, bonuses) ?? []);
}

/** The cap that counts: the lowest. */
export const lowestCap = (caps: readonly Cap[]): Cap | null =>
    caps.reduce<Cap | null>((low, cap) => (!low || cap.total < low.total ? cap : low), null);

/**
 * The lowest cap of `key` that the item itself puts on, raised as it would be
 * while worn; also for an item put away, whose entries count nowhere.
 */
export function itemCap(state: SheetSignals, item: GearItem, key: string): Cap | null {
    const has = names(state, key);
    const refs = gearItemEntries(item).filter(r => has(r.entry));
    const caps = refs.filter(r => r.entry.type?.value === "char_cap");
    if (!caps.length) return null;
    const bonuses = [
        ...refs.filter(r => r.entry.type?.value === "char_cap_bonus"),
        ...collectEntries(state, "char_cap_bonus", has).filter(b => !b.item),
    ];
    return lowestCap(caps.flatMap(ref => raisedCap(ref, bonuses) ?? []));
}

/**
 * The item's caps of the characteristics its material raises (Mithral's A),
 * for the line of the material's effects; none for an item without such a cap.
 */
export function materialCaps(state: SheetSignals, item: GearItem): { key: string; cap: Cap }[] {
    const raising = gearItemEntries(item)
        .filter(r => r.source === item.material && r.entry.type?.value === "char_cap_bonus");
    return Object.keys(state.characteristics ?? {}).flatMap(key => {
        if (!raising.some(r => names(state, key)(r.entry))) return [];
        const cap = itemCap(state, item, key);
        return cap ? [{ key, cap }] : [];
    });
}

/** "35 Mail Hauberk", "+20 Mithral", "= 55": how the cap is made up, for a title. */
export function capLines(cap: Cap): string[] {
    return [
        `${cap.base} ${sourceName(cap.ref)}`,
        ...cap.raises.map(r => `${signed(r.value)} ${r.source}`),
        `= ${cap.total}`,
    ];
}
