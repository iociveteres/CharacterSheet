
// The damage and penetration of an item with their modifiers (../damage.ts),
// as the character's state gives the references their values. What each kind
// of item adds is its DamageOwner: weaponDamage.ts, powerDamage.ts,
// techDamage.ts. Reactive when read inside a computed.
import { nanoid } from "nanoid";
import {
    addTerms, addedBy, emptySum, formatSum, hasProperty, parseDamage, resolveDamage, withTearing,
    type ResolvedDamage, type WeaponMod,
} from "../damage";
import { characteristicKeys } from "../state/characteristics";
import { idsInOrder } from "../core/gridOrder";
import { textAt, valueAt } from "../core/sync";
import type { SheetSignals } from "../schema/sheet";

/** The characteristics a reference can name: those of the sheet. */
export const refKeys = characteristicKeys;

/** The references the damage of an item can hold, as parseDamage and resolveDamage take them. */
export interface DamageRefs {
    keys: readonly string[];
    named: readonly string[];
    valueOf: (ref: string) => number;
}

/** A value of a weapon or power that takes modifiers: its own in `stat`, the modifiers in `${stat}Mods`. */
export type WeaponStat = "damage" | "pen";

/** The modifiers of `stat` of the attack or melee profile at `itemPath`, in the order of their grid. */
export function modsAt(state: SheetSignals, itemPath: string, stat: WeaponStat): WeaponMod[] {
    const grid = `${itemPath}.${stat}Mods.items`;
    return idsInOrder(state, grid).map(id => ({ expr: textAt(state, `${grid}.${id}.expr`), enabled: !!valueAt(state, `${grid}.${id}.enabled`) }));
}

/** A damage or penetration as the sheet shows and rolls it. */
export interface StatText {
    /** What a roll sends: the damage with the modifiers, or the text as typed when it is no expression. */
    expression: string;
    /** The damage as shown: the expression and its alternative in brackets, as "1d10+6 [1d10+9]". */
    text: string;
    /** What each counted modifier adds, as "S.b +4" or "+1d10" for one without references. */
    parts: string[];
    /** Whether the base reads as an expression; only then do the modifiers count. */
    parsed: boolean;
    /** Whose base counts when not the item's own, as "Mace" for a weapon in Mordhau. */
    own?: string;
    /** The counted modifiers that come from elsewhere than the item's grid, as "+1" and "Mithral (Longsword)". */
    added: { text: string; label: string }[];
}

/** How `resolved` shows: modifiers with references are named by their expression. */
export function statText({ typed, sum, alt, mods }: ResolvedDamage): StatText {
    if (!sum) return { expression: typed, text: typed, parts: [], parsed: false, added: [] };
    const expression = formatSum(sum);
    const text = alt === undefined ? expression : `${expression} [${typeof alt === "string" ? alt : formatSum(alt)}]`;
    const parts = mods.map(({ expr, label, terms, added }) =>
        (label ? `${label} ${addedBy(added)}` : terms.some(t => t.kind === "ref" || t.kind === "refDice") ? `${expr} ${addedBy(added)}` : addedBy(added)));
    const added = mods.flatMap(({ label, added }) => (label ? [{ text: addedBy(added), label }] : []));
    return { expression, text, parts, parsed: true, added };
}

/** The base and the modifiers `stat` of an item counts, and whose base it is when not the item's own. */
export interface StatCounts {
    base: string;
    mods: WeaponMod[];
    own: string | null;
}

/** `stat` of the item of `owner` at `itemPath` with its modifiers. */
export function statAt(state: SheetSignals, owner: DamageOwner, itemPath: string, stat: WeaponStat): StatText {
    const { keys, named, valueOf } = owner.refs(state, itemPath);
    const own = textAt(state, `${itemPath}.${stat}`);
    const mods = modsAt(state, itemPath, stat);
    const counts = owner.counts?.(state, itemPath, stat, own, mods, keys) ?? { base: own, mods, own: null };
    const text = statText(resolveDamage(counts.base, counts.mods, keys, valueOf, named));
    return counts.own ? { ...text, own: `${counts.own} ${counts.base}` } : text;
}

/** What the damage roll of the item of `owner` at `itemPath` sends: with Tearing, a die more and the lowest dropped. */
export function damageRoll(state: SheetSignals, owner: DamageOwner, itemPath: string): string {
    const { expression, parsed } = statAt(state, owner, itemPath, "damage");
    const special = owner.special?.(state, itemPath) ?? textAt(state, `${itemPath}.special`);
    return parsed && hasProperty(special, "Tearing") ? withTearing(expression) : expression;
}

/** What the modifier `expr` adds to the item of `owner` at `itemPath`, as "+4"; "—" while it reads as nothing. */
export function modAddedAt(state: SheetSignals, owner: DamageOwner, itemPath: string, expr: string): string {
    const { keys, named, valueOf } = owner.refs(state, itemPath);
    const { terms, invalid } = parseDamage(expr, keys, named);
    return invalid.length || terms.length === 0 ? "—" : addedBy(addTerms(emptySum(), terms, valueOf));
}

/** A grid of `mods` of `stat` under new ids, as a new item holds them. */
export function modsGrid(mods: readonly WeaponMod[], stat: WeaponStat) {
    const ids = mods.map(() => `${stat}-mod-${nanoid()}`);
    return {
        items: Object.fromEntries(mods.map(({ expr, enabled }, i) => [ids[i], { expr, enabled }])),
        layouts: Object.fromEntries(ids.map((id, i) => [id, { colIndex: 0, rowIndex: i }])),
    };
}

/** An attack, melee profile or power whose modifiers can be copied. */
export interface ModSource {
    path: string;
    /** Melee or Ranged for weapons, the name of its tab for a power. */
    group: string;
    label: string;
    mods: WeaponMod[];
}

/** The items of `candidates` with modifiers of `stat`, but the one at `exceptPath`. */
export function withMods(state: SheetSignals, candidates: Omit<ModSource, "mods">[], exceptPath: string, stat: WeaponStat): ModSource[] {
    return candidates
        .filter(c => c.path !== exceptPath)
        .map(c => ({ ...c, mods: modsAt(state, c.path, stat) }))
        .filter(c => c.mods.length > 0);
}

/**
 * The items whose damage and penetration take modifiers alike: the
 * references their expressions can hold and the items modifiers are copied
 * from.
 */
export interface DamageOwner {
    refs(state: SheetSignals, itemPath: string): DamageRefs;
    /** The base and modifiers `stat` counts when not the item's `own` and `mods`, as a melee grip changes them. */
    counts?(state: SheetSignals, itemPath: string, stat: WeaponStat, own: string, mods: WeaponMod[], keys: readonly string[]): StatCounts;
    /** The Special that counts when not the item's own, as grips and the linked item add to a weapon's. */
    special?(state: SheetSignals, itemPath: string): string;
    /** The items with modifiers of `stat` but the one at `exceptPath`. */
    sources(state: SheetSignals, exceptPath: string, stat: WeaponStat): ModSource[];
}
