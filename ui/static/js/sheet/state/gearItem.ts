// A gear item's mods, weight and entries, from its material, enchantments
// and Quality.
import { enchantmentsOf } from "./enchantments";
import { materialOf, weaponModsOf, weightFactors, type GearItem, type WeightFactor } from "./materials";
import { armourQualityEntries } from "./quality";
import type { Entry, EntryRef } from "../conditions/entries";

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;

/** The mods of a gear item's armour, which count only while the item is armour, as its AP. */
const armourMods = (item: GearItem) =>
    item.gearType?.value === "armour" ? Object.values(item.armour?.mods?.items ?? {}) : [];

/** The mods of a gear item: of its weapon while it is a weapon, else of its armour. */
export const gearMods = (item: GearItem) =>
    item.gearType?.value === "weapon" ? weaponModsOf(item) : armourMods(item);

/** What the mods of a gear item weigh; summed in thousandths as the encumbrance sums the items, so 0.1 + 0.2 is 0.3. */
export function modsWeight(item: GearItem): number {
    let total = 0;
    for (const mod of gearMods(item)) total += Math.round(num(mod.weight) * 1000);
    return total / 1000;
}

export interface GearWeight {
    own: number;
    factors: WeightFactor[];
    mods: number;
    total: number;
}

/** What a gear item weighs: its own weight times its factors (state/materials.ts), plus its mods. */
export function gearWeight(item: GearItem): GearWeight {
    const own = num(item.weight);
    const factors = weightFactors(item);
    const mods = modsWeight(item);
    const scaled = factors.reduce((w, f) => w * f.factor, own);
    return { own, factors, mods, total: (Math.round(scaled * 1000) + Math.round(mods * 1000)) / 1000 };
}

/**
 * The entries of a gear item, whether or not it is equipped: its own, its
 * material's while it has one, its mods' (of its armour or weapon, as its
 * type), its enchantments' and its Quality's (Poor armour, state/quality.ts).
 */
export function gearItemEntries(item: GearItem): EntryRef[] {
    const refs: EntryRef[] = [];
    const add = (entries: { items: { [id: string]: Entry } } | undefined, source: EntryRef['source']) => {
        for (const entry of Object.values(entries?.items ?? {})) refs.push({ entry, stacks: 1, source, item });
    };
    add(item.entries, item);
    if (materialOf(item)) add(item.material!.entries, item.material!);
    for (const mod of gearMods(item)) add(mod.entries, mod);
    // Of any gear type: an enchanted ring or cloak counts.
    for (const ench of enchantmentsOf(item)) add(ench.entries, ench);
    for (const { entry, source } of armourQualityEntries(item)) refs.push({ entry, stacks: 1, source, item });
    return refs;
}
