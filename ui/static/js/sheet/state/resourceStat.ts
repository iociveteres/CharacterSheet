// A value a base expression and modifiers make (ResourceStat in Go): the
// cognition and energy of Techno Arcana (tech.ts), the mana of Pathfinder
// Crusade (mana.ts), the fatigue threshold. An empty base counts the default
// of the rules.
import { BASE_PR, addTerms, emptySum, parseDamage } from "../damage";
import { characteristicBonus, characteristicKeys } from "./characteristics";
import { idsInOrder } from "./gridOrder";
import { numberAt, textAt, valueAt } from "./sync";
import type { SheetSignals } from "../schema/sheet";

/** The references by name an expression of a resource stat holds: none, only characteristic bonuses. */
export const RESOURCE_REFS: readonly string[] = [];

/** A characteristic's bonus, or the base psy rating. */
export function refValue(state: SheetSignals, ref: string): number {
    return ref === BASE_PR ? numberAt(state, "psykana.basePR") : characteristicBonus(state, ref);
}

/**
 * A number such as "½I.b▲" or "-1" makes, as damage reads its references,
 * by name one of `refs`; null when it reads as none or holds dice.
 */
export function resourceValue(state: SheetSignals, expr: string, refs = RESOURCE_REFS): number | null {
    const { terms, invalid } = parseDamage(expr, characteristicKeys(state), refs);
    if (invalid.length || terms.length === 0 || terms.some(t => t.kind === "dice" || t.kind === "refDice")) return null;
    return addTerms(emptySum(), terms, ref => refValue(state, ref)).flat;
}

export interface ResourceModValue {
    name: string;
    expr: string;
    value: number;
}

export interface ResourceStatValue {
    /** The base as it counts: as typed, or the default when empty. */
    base: string;
    /** Whether the base is the default of the rules. */
    byDefault: boolean;
    /** What the base comes to; null when it reads as none, and then only the modifiers count. */
    baseValue: number | null;
    /** The enabled modifiers that read, in the order of their grid. */
    mods: ResourceModValue[];
    total: number;
}

/** The enabled modifiers of the grid at `grid` that read, in its order, with what `extra` reads of each. */
export function enabledMods<T extends object>(
    state: SheetSignals, grid: string, extra: (mod: string) => T = () => ({}) as T, refs = RESOURCE_REFS,
): (ResourceModValue & T)[] {
    return idsInOrder(state, grid)
        .map(id => `${grid}.${id}`)
        .filter(mod => valueAt(state, `${mod}.enabled`))
        .flatMap(mod => {
            const value = resourceValue(state, textAt(state, `${mod}.expr`), refs);
            return value === null ? [] : [{ name: textAt(state, `${mod}.name`).trim(), expr: textAt(state, `${mod}.expr`).trim(), value, ...extra(mod) }];
        });
}

/** The stat at `path`, its base `fallback` while empty; its expressions name `refs`. */
export function exprStat(state: SheetSignals, path: string, fallback: string, refs = RESOURCE_REFS): ResourceStatValue {
    const typed = textAt(state, `${path}.base`).trim();
    const base = typed || fallback;
    const baseValue = resourceValue(state, base, refs);
    const mods = enabledMods(state, `${path}.mods.items`, undefined, refs);
    const total = (baseValue ?? 0) + mods.reduce((sum, mod) => sum + mod.value, 0);
    return { base, byDefault: !typed, baseValue, mods, total };
}

/** The fatigue threshold, T.b+W.b by the rules. */
export const FATIGUE_THRESHOLD = "T.b+W.b";

export const fatigueThreshold = (state: SheetSignals) => exprStat(state, "fatigue.threshold", FATIGUE_THRESHOLD);
