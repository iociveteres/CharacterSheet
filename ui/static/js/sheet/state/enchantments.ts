// The enchantments of a gear item in Pathfinder Crusade
// (_prd/item_materials/plan.md, blocks/Enchantments.tsx). What counts is the
// enchantment's own capacity, weight factor and entries, copied from its
// chosen level: the capacity against the item's (state/materials.ts
// itemCapacity), the weight factor in the item's weight, the entries while
// the item is equipped (state/computed.ts).
import { Signal } from "@preact/signals-core";
import { columnsFromLayout } from "../components/columns";
import type { Position } from "../schema/content.gen";
import type { gearEnchantment } from "../schema/sheet";
import type { SignalsOf } from "../schema/spec";
import type { SignalTree } from "./fromJson";
import type { GearItem, WeightFactor } from "./materials";

export type Enchantment = SignalsOf<typeof gearEnchantment>;
type Level = Enchantment["levels"]["items"][string];

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;

/** The enchantments of the item in the order of their chips. */
export function enchantmentsOf(item: GearItem): Enchantment[] {
    const grid = item.enchantments;
    if (!grid) return [];
    const ids = columnsFromLayout(1, grid.layouts.value as { [id: string]: Position }, Object.keys(grid.items))[0];
    return ids.map(id => grid.items[id]);
}

/** The ids of the enchantment's levels in the order of the collection. */
export function levelIds(enchantment: Enchantment): string[] {
    const { items, layouts } = enchantment.levels;
    return columnsFromLayout(1, layouts.value as { [id: string]: Position }, Object.keys(items))[0];
}

/** The capacity the item's enchantments take, summed in thousandths as the weights are. */
export function capacityUsed(item: GearItem): number {
    let total = 0;
    for (const e of enchantmentsOf(item)) total += Math.round(num(e.capacity) * 1000);
    return total / 1000;
}

/** The text of the enchantment's chip: its name, with its capacity when it has levels to choose from. */
export function chipText(enchantment: Enchantment): string {
    const name = String(enchantment.name.value ?? "").trim() || "—";
    return Object.keys(enchantment.levels.items).length > 1 ? `${name} ${num(enchantment.capacity)}` : name;
}

/** What the enchantments multiply the item's weight by (Feather); a factor of 1 is left out. */
export function enchantmentWeightFactors(item: GearItem): WeightFactor[] {
    return enchantmentsOf(item)
        .filter(e => (e.weightFactor?.value ?? 1) !== 1)
        .map(e => ({ factor: num(e.weightFactor), source: String(e.name.value ?? "").trim() || "enchantment" }));
}

/** The plain value of a signal tree, as a batch carries it. */
function plainOf(node: SignalTree | Signal<unknown>): unknown {
    if (node instanceof Signal) return node.peek();
    const out: { [key: string]: unknown } = {};
    for (const [key, child] of Object.entries(node as SignalTree)) out[key] = plainOf(child);
    return out;
}

/** The batch that chooses `level`: its capacity, weight factor, text, special and entries become the enchantment's. */
export function levelBatch(id: string, level: Level): { [key: string]: unknown } {
    return {
        level: id,
        capacity: level.capacity.peek(),
        weightFactor: level.weightFactor.peek(),
        description: level.text.peek(),
        special: level.special.peek(),
        entries: plainOf(level.entries as unknown as SignalTree),
    };
}
