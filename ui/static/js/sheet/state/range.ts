// The range of a ranged attack (blocks/Range.tsx): its own as the rulebook
// gives it, "S.b×10м" or "50м", and S.b×3 by the rules for a thrown weapon or
// grenade without one (wiki «ii механика › бой › стрельба»). Its modifiers
// add a term ("+5", "S.b") or multiply the sum ("×2", "×1.5▼", rounded down
// unless ▲), as the enchantments of bracers and ranged weapons do.
import { WEAPON_REFS, parseFactor } from "../damage";
import type { SheetSignals } from "../schema/sheet";
import { idsInOrder } from "./gridOrder";
import { resourceValue } from "./resourceStat";
import { textAt, valueAt } from "./sync";
import { weaponBonuses } from "./weaponBonus";

/** The range of a thrown weapon or grenade without one of its own. */
export const THROWN_RANGE = "S.b×3м";
const THROWN_CLASSES = ["throwing", "grenade"];

// The metres of the rulebooks, Russian or not.
const UNIT = /\s*([мm])\.?\s*$/i;
const FACTOR = /^[×x*]\s*(½|\d+\/\d+|\d*\.\d+|\d+)\s*([▲▼])?$/i;

export type RangeMod = { expr: string; factor: number; roundUp: boolean } | { expr: string; add: number };

/** What the modifier `expr` does: multiplies the range by a factor, or adds a number; null when it reads as neither. */
export function rangeMod(state: SheetSignals, expr: string): RangeMod | null {
    const text = expr.trim();
    const factor = text.match(FACTOR);
    if (factor) {
        const value = parseFactor(factor[1]);
        return Number.isFinite(value) ? { expr: text, factor: value, roundUp: factor[2] === "▲" } : null;
    }
    const add = resourceValue(state, text.replace(UNIT, ""), WEAPON_REFS);
    return add === null ? null : { expr: text, add };
}

export interface RangeValue {
    /** The range as it counts: as typed, or the rule's. */
    base: string;
    /** Whether the base is the rule of thrown weapons. */
    byRule: boolean;
    /** What the base comes to; null when it reads as no number, and then the modifiers do not count. */
    baseValue: number | null;
    /** The enabled modifiers that read, in the order of their grid. */
    mods: RangeMod[];
    /** What the row shows: the total with the base's unit, or the base as typed. */
    text: string;
}

/** `value` rounded down, or up with `up`, after the float noise of the multiplication. */
const round = (value: number, up: boolean) => {
    const clean = Math.round(value * 1e6) / 1e6;
    return up ? Math.ceil(clean) : Math.floor(clean);
};

/** The range of the ranged attack at `path`. */
export function rangeAt(state: SheetSignals, path: string): RangeValue {
    const typed = textAt(state, `${path}.range`).trim();
    const byRule = !typed && THROWN_CLASSES.includes(textAt(state, `${path}.class`));
    const base = typed || (byRule ? THROWN_RANGE : "");
    const unit = base.match(UNIT)?.[1] ?? "";
    const baseValue = base ? resourceValue(state, base.replace(UNIT, ""), WEAPON_REFS) : null;
    const grid = `${path}.rangeMods.items`;
    // The weapon entries of conditions add to it as its own modifiers do, named by their source.
    const entries = [...weaponBonuses(state, path, "rng"), ...weaponBonuses(state, path, "rngMax")].map(b => ({ expr: b.label, add: b.add }));
    const mods = [
        ...idsInOrder(state, grid)
            .filter(id => valueAt(state, `${grid}.${id}.enabled`))
            .flatMap(id => rangeMod(state, textAt(state, `${grid}.${id}.expr`)) ?? []),
        ...entries,
    ];
    if (baseValue === null) return { base, byRule, baseValue, mods, text: base };

    let total = baseValue;
    for (const mod of mods) if ("add" in mod) total += mod.add;
    for (const mod of mods) if ("factor" in mod) total = round(total * mod.factor, mod.roundUp);
    return { base, byRule, baseValue, mods, text: `${total}${unit}` };
}
