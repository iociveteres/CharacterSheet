// The material, inlay gem and Broken mark of a gear item in Pathfinder
// Crusade (_prd/item_materials/plan.md, blocks/Materials.tsx). The material
// multiplies the item's weight (state/computed.ts gearWeight) and capacity,
// adds its AP to the covered locations (state/armour.ts gearApTotal), and a
// broken item has half its AP. A sheet of a kind without them has none of
// these fields: its items weigh and protect as their own fields say.
import { INLAY_GEMS } from "../schema/constants";
import { enchantmentWeightFactors } from "./enchantments";
import type { gearMaterialFields, SheetSignals } from "../schema/sheet";
import type { GroupSpec, SignalsOf } from "../schema/spec";

export type GearItem = SheetSignals["gear"]["list"]["items"][string] &
    Partial<SignalsOf<GroupSpec<typeof gearMaterialFields>>>;

export interface Material {
    name: string;
    weightFactor: number;
    capacityFactor: number;
    durability: number;
    ap: number;
    pen: number;
    short: string;
    special: string;
}

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;
// A factor of 0 reads as 1, as the schema's emptyAsDefault does.
const factor = (s: { value: unknown } | undefined) => num(s) || 1;

/** The material of the item; null while it has none named, so a cleared name drops its effects. */
export function materialOf(item: GearItem): Material | null {
    const m = item.material;
    const name = String(m?.name?.value ?? "").trim();
    if (!m || !name) return null;
    return {
        name,
        weightFactor: factor(m.weightFactor),
        capacityFactor: factor(m.capacityFactor),
        durability: num(m.durability),
        ap: num(m.ap),
        pen: num(m.pen),
        short: String(m.short?.value ?? ""),
        special: String(m.special?.value ?? ""),
    };
}

export const isBroken = (item: GearItem) => !!item.broken?.value;

export interface WeightFactor {
    factor: number;
    source: string;
}

/** What multiplies the item's own weight, each with what it comes from: its material, then its enchantments; a factor of 1 is left out. */
export function weightFactors(item: GearItem): WeightFactor[] {
    const material = materialOf(item);
    const own = material && material.weightFactor !== 1 ? [{ factor: material.weightFactor, source: material.name }] : [];
    return [...own, ...enchantmentWeightFactors(item)];
}

/** What every item can hold of enchantments before its material and gem. */
export const BASE_CAPACITY = 8;

export interface Capacity {
    total: number;
    /** How it is made up, for the title of its counter. */
    lines: string[];
}

/** The capacity of the item for enchantments: the base times its material's factor, plus its gem's bonus. */
export function itemCapacity(item: GearItem): Capacity {
    const material = materialOf(item);
    const gem = INLAY_GEMS.find(g => g.name === item.inlay?.value);
    const capacityFactor = material?.capacityFactor ?? 1;
    const lines = [`${BASE_CAPACITY} base`];
    if (material) lines.push(`× ${capacityFactor} ${material.name}`);
    if (gem) lines.push(`+ ${gem.capacityBonus} ${gem.name}`);
    const total = BASE_CAPACITY * capacityFactor + (gem?.capacityBonus ?? 0);
    lines.push(`= ${total}`);
    return { total, lines };
}
