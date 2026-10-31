// The link of a melee attack to a Natural Weapons trait of the sheet
// (_prd/item_materials/plan.md): the attack keeps the trait's id in `trait`
// and reads the rating X from the trait's name, "Natural Weapons (2)", each
// time it counts. X adds to the damage, and to the Pen of Deadly Natural
// Weapons; the rulebook's profiles leave it out. A link to a deleted trait,
// or to one renamed into another trait, stays on the attack and gives nothing.
import type { NaturalWeapon } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { signed } from "../system";
import type { WeaponStat } from "./damage";
import { idsInOrder } from "./gridOrder";
import { attackOf } from "./itemLink";
import { textAt, valueAt } from "./sync";

const TRAITS = "traits.list.items";

export const NATURAL_WEAPONS = "Natural Weapons";
export const DEADLY_NATURAL_WEAPONS = "Deadly Natural Weapons";

/** The two traits by the name before the brackets, in any case, the rulebook's Russian too. */
const TRAIT_NAMES: Readonly<Record<string, string>> = {
    "natural weapons": NATURAL_WEAPONS,
    "естественное оружие": NATURAL_WEAPONS,
    "deadly natural weapons": DEADLY_NATURAL_WEAPONS,
    "смертельное естественное оружие": DEADLY_NATURAL_WEAPONS,
};

/** What the name of a Natural Weapons trait says: "Deadly Natural Weapons (3, Claws)". */
export interface NaturalTrait {
    /** NATURAL_WEAPONS or DEADLY_NATURAL_WEAPONS. */
    trait: string;
    deadly: boolean;
    /** X, the first number in the brackets; null when they hold none, as "(X)". */
    rating: number | null;
    /** Y of the form (X, Y): the one weapon the trait gives; empty for all of them. */
    weapon: string;
}

/** The trait named `name` when it is Natural Weapons or Deadly Natural Weapons; null for any other. */
export function naturalTrait(name: string): NaturalTrait | null {
    const m = name.trim().match(/^([^(]*?)\s*(?:\((.*)\))?$/);
    const trait = m ? TRAIT_NAMES[m[1].replace(/\s+/g, " ").toLowerCase()] : undefined;
    if (!m || !trait) return null;
    const inside = m[2] ?? "";
    const number = inside.match(/[+-]?\d+/);
    const comma = inside.indexOf(",");
    return {
        trait,
        deadly: trait === DEADLY_NATURAL_WEAPONS,
        rating: number ? Number(number[0]) : null,
        weapon: comma < 0 ? "" : inside.slice(comma + 1).trim(),
    };
}

/** X of `t`, 0 when its name has no number. */
export const ratingOf = (t: NaturalTrait) => t.rating ?? 0;

/** The name of the trait `id`; null when there is none. Reactive to deletes, as gearItemAt. */
export function traitNameAt(state: SheetSignals, id: string): string | null {
    valueAt(state, "traits.list.layouts");
    return state.traits?.list?.items?.[id] ? textAt(state, `${TRAITS}.${id}.name`).trim() : null;
}

export interface SheetTrait {
    id: string;
    name: string;
    natural: NaturalTrait;
}

/** The sheet's Natural Weapons and Deadly Natural Weapons traits, in the order of the grid. */
export function naturalTraits(state: SheetSignals): SheetTrait[] {
    return idsInOrder(state, TRAITS).flatMap(id => {
        const name = textAt(state, `${TRAITS}.${id}.name`).trim();
        const natural = naturalTrait(name);
        return natural ? [{ id, name, natural }] : [];
    });
}

export interface TraitLink {
    id: string;
    /** The trait's name; null when it was deleted. */
    name: string | null;
    /** What the name says; null when deleted or no Natural Weapons any more. */
    natural: NaturalTrait | null;
}

/** The trait the melee attack of `weaponPath` is linked to; null without a link. */
export function traitLinkOf(state: SheetSignals, weaponPath: string): TraitLink | null {
    const id = textAt(state, `${attackOf(weaponPath)}.trait`);
    if (!id) return null;
    const name = traitNameAt(state, id);
    return { id, name, natural: name === null ? null : naturalTrait(name) };
}

/** X of the linked trait as a modifier of `stat` named by the trait: the damage always, the Pen of Deadly ones. */
export function traitMods(state: SheetSignals, weaponPath: string, stat: WeaponStat) {
    if (!weaponPath.startsWith("meleeAttacks.")) return [];
    const link = traitLinkOf(state, weaponPath);
    const natural = link?.natural;
    if (!natural || (stat === "pen" && !natural.deadly)) return [];
    return [{ expr: signed(ratingOf(natural)), enabled: true, label: link.name! }];
}

/** The weapons the trait gives of `profiles`: the one its Y names ("Claw" names Claws), else all. */
export function profilesOf(profiles: readonly NaturalWeapon[], natural: NaturalTrait): readonly NaturalWeapon[] {
    const y = natural.weapon.toLowerCase();
    const named = y ? profiles.filter(p => p.name.toLowerCase().startsWith(y) || p.ru.toLowerCase().startsWith(y)) : [];
    return named.length ? named : profiles;
}

/** The melee collection's name of a profile of the trait: "Claws (Deadly Natural Weapons)". */
export const entryName = (profile: NaturalWeapon, natural: NaturalTrait) => `${profile.name} (${natural.trait})`;

/**
 * The X a pick of the melee entry of `entryTrait` ("Natural Weapons (X)", as
 * the collection names its trait) puts in as a modifier: of the sheet's first
 * trait of the same name with a number, else "X", which the modifier cannot
 * count and the player puts the number in.
 */
export function pickedRating(state: SheetSignals, entryTrait: string): string {
    const wanted = naturalTrait(entryTrait)?.trait;
    const own = naturalTraits(state).find(t => t.natural.trait === wanted && t.natural.rating !== null);
    return own ? String(own.natural.rating) : "X";
}
