// The caps of characteristics a gear item puts on itself, raised by its own
// Cap Bonuses and the character-wide ones (characteristics/caps.ts).
import type { SheetSignals } from "../schema/sheet";
import { collectEntries } from "../modifiers/entries";
import { lowestCap, namesCharacteristic, raisedCap, type Cap } from "../characteristics/caps";
import { gearItemEntries } from "./gearItem";
import type { GearItem } from "./materialRules";

/**
 * The lowest cap of `key` that the item itself puts on, raised as it would be
 * while worn; also for an item put away, whose entries count nowhere.
 */
export function itemCap(state: SheetSignals, item: GearItem, key: string): Cap | null {
    const has = namesCharacteristic(state, key);
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
        if (!raising.some(r => namesCharacteristic(state, key)(r.entry))) return [];
        const cap = itemCap(state, item, key);
        return cap ? [{ key, cap }] : [];
    });
}
