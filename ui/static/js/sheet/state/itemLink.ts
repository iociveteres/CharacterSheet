// The link of a melee or ranged attack to a gear item (_prd/item_materials/plan.md):
// the attack keeps the item's id in `item`. What the item gives the attack is
// computed, never written into it: its material's Pen, the Special of its
// enchantments, its weapon entries named "This item" (state/weaponBonus.ts)
// and Broken, which halves the damage left after armour. A link to a deleted
// item stays on the attack and gives nothing.
import type { SheetSignals } from "../schema/sheet";
import { signed } from "../system";
import { chipText, enchantmentsOf } from "./enchantments";
import { idsInOrder } from "./gridOrder";
import { isBroken, materialOf, type GearItem } from "./materials";
import { textAt, valueAt } from "./sync";

export const MELEE_ATTACKS = "meleeAttacks.list.items";
export const RANGED_ATTACKS = "rangedAttacks.list.items";
const GEAR = "gear.list.items";

export type AttackBlock = typeof MELEE_ATTACKS | typeof RANGED_ATTACKS;

/** The attack a melee profile tab at `weaponPath` belongs to; a ranged attack or a melee attack is its own. */
export const attackOf = (weaponPath: string) => weaponPath.replace(/\.tabs\.items\.[^.]+$/, "");

/** The gear item `id`; null when there is none. Reactive to deletes: the grid's items object is no signal, its layouts are. */
export function gearItemAt(state: SheetSignals, id: string): GearItem | null {
    valueAt(state, "gear.list.layouts");
    return (state.gear?.list?.items?.[id] as GearItem | undefined) ?? null;
}

export const itemName = (item: GearItem) => String(item.name?.value ?? "").trim() || "Item";

export interface Link {
    id: string;
    /** Null when the item was deleted. */
    item: GearItem | null;
}

/** The gear item the attack of `weaponPath` is linked to; null without a link. */
export function linkOf(state: SheetSignals, weaponPath: string): Link | null {
    const id = textAt(state, `${attackOf(weaponPath)}.item`);
    return id ? { id, item: gearItemAt(state, id) } : null;
}

/** The linked item while it exists. */
export const linkedItem = (state: SheetSignals, weaponPath: string): GearItem | null => linkOf(state, weaponPath)?.item ?? null;

export interface WeaponItem {
    id: string;
    item: GearItem;
}

/** The weapons of the gear, in the order of the grid. */
export function weaponItems(state: SheetSignals): WeaponItem[] {
    return idsInOrder(state, GEAR)
        .map(id => ({ id, item: state.gear.list.items[id] as GearItem }))
        .filter(({ item }) => item?.gearType?.value === "weapon");
}

/** The names of the item's enchantments, as their chips show them. */
export const enchantmentNames = (item: GearItem): string[] => enchantmentsOf(item).map(chipText);

/** The item in a list of the gear: its name and material, "Longsword · Mithral". */
export function itemLabel(item: GearItem): string {
    const material = materialOf(item);
    return material ? `${itemName(item)} · ${material.name}` : itemName(item);
}

export interface LinkedAttack {
    path: string;
    block: AttackBlock;
    name: string;
}

/** The attacks linked to the gear item `itemId`, melee then ranged. */
export function linkedAttacks(state: SheetSignals, itemId: string): LinkedAttack[] {
    return [MELEE_ATTACKS, RANGED_ATTACKS].flatMap(block => idsInOrder(state, block)
        .map(id => `${block}.${id}`)
        .filter(path => textAt(state, `${path}.item`) === itemId)
        .map(path => ({ path, block: block as AttackBlock, name: textAt(state, `${path}.name`).trim() })));
}

/** Whether another attack of `block` than the one at `exceptPath` is linked to the item `itemId`. */
export const linkedInBlock = (state: SheetSignals, block: AttackBlock, itemId: string, exceptPath: string) =>
    idsInOrder(state, block).some(id => `${block}.${id}` !== exceptPath && textAt(state, `${block}.${id}.item`) === itemId);

/** The label of a line the item gives the attack: its source, and the item when that is not the item itself. */
export const linkedLabel = (item: GearItem, source: string) => (source === itemName(item) ? source : `${source} (${itemName(item)})`);

/** The Pen the material of the linked item adds to the weapon at `weaponPath`, as a modifier named by the material. */
export function materialPenMods(state: SheetSignals, weaponPath: string) {
    const item = linkedItem(state, weaponPath);
    const material = item && materialOf(item);
    if (!material || material.pen === 0) return [];
    return [{ expr: signed(material.pen), enabled: true, label: linkedLabel(item, material.name) }];
}

export interface AddedProperty {
    text: string;
    /** The enchantment it comes from, as its chip names it. */
    source: string;
}

/** The Special the enchantments of the linked item add to the weapon at `weaponPath`, but what its own Special names already. */
export function addedProperties(state: SheetSignals, weaponPath: string): AddedProperty[] {
    const item = linkedItem(state, weaponPath);
    if (!item) return [];
    const special = textAt(state, `${weaponPath}.special`).toLowerCase();
    return enchantmentsOf(item)
        .map(e => ({ text: String(e.special?.value ?? "").trim(), source: chipText(e) }))
        .filter(p => p.text && !special.includes(p.text.toLowerCase()));
}

/** The linked item while it is broken: the damage it deals is halved after armour. */
export function brokenItem(state: SheetSignals, weaponPath: string): GearItem | null {
    const item = linkedItem(state, weaponPath);
    return item && isBroken(item) ? item : null;
}

/** The note of a broken linked item on the damage of the weapon at `weaponPath`; empty while it is whole. */
export function brokenNote(state: SheetSignals, weaponPath: string): string {
    const item = brokenItem(state, weaponPath);
    return item ? `½ after armour: ${itemName(item)} is broken` : "";
}
