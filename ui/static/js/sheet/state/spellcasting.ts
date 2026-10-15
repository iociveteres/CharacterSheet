// Spellcasting, the class traits «X Spellcasting» of Pathfinder Crusade
// (wiki «i создание персонажа › архетипы › <class> › Трейты»): a set of
// variants the caster ticks (StatSet.spellcasting). A PR spell casts by one
// of the PR variants ticked, which gives it its gift and the characteristic
// of Cast; the variants decide the preparation, the bases of the mana and of
// the Focus pools, and how far the PR grows. Rules and decisions:
// _prd/sheet_kinds/spellcasting.md.
import { characteristicBonus } from "./characteristics";
import { MANA_REFS, type ManaPool } from "./mana";
import { isSorcery } from "./psychic";
import { resourceValue } from "./resourceStat";
import { focusVariant } from "./sorcery";
import { statsOf } from "./state";
import { numberAt, textAt, valueAt } from "./sync";
import type { SpellcastingVariant } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

/** Whether the sheet's kind has Spellcasting: only the Pathfinder Crusade schema adds its block. */
export const hasSpellcasting = (state: SheetSignals) => "spellcasting" in state;

const isTicked = (state: SheetSignals, variant: SpellcastingVariant) => !!valueAt(state, `spellcasting.${variant.key}`);

/** The variants ticked, in the kind's order; none on a sheet without Spellcasting. */
export const tickedVariants = (state: SheetSignals): SpellcastingVariant[] =>
    (hasSpellcasting(state) ? statsOf(state).spellcasting.filter(v => isTicked(state, v)) : []);

/** The PR variants ticked, in the kind's order. */
export const prVariants = (state: SheetSignals) => tickedVariants(state).filter(v => v.way === "pr");

/**
 * The PR variant the spell at `powerPath` is cast by: the one its roll picks
 * while ticked, else the first PR variant ticked; null with none ticked and
 * for a Sorcery spell.
 */
export function spellVariant(state: SheetSignals, powerPath: string): SpellcastingVariant | null {
    if (isSorcery(state, powerPath)) return null;
    const ticked = prVariants(state);
    const picked = textAt(state, `${powerPath}.roll.spellcasting`);
    return ticked.find(v => v.key === picked) ?? ticked[0] ?? null;
}

/**
 * The nature of the gift (Природа Дара) a cast of the spell at `powerPath`
 * has: on a sheet with Spellcasting its variant's, the first PR variant's
 * without a spell, "" without a variant; else the Psykana type picked, the
 * same for every power.
 */
export function giftOf(state: SheetSignals, powerPath?: string): string {
    if (!hasSpellcasting(state)) return textAt(state, "psykana.psykanaType");
    return (powerPath === undefined ? prVariants(state)[0] : spellVariant(state, powerPath))?.gift ?? "";
}

/** What Cast tests the spell at `powerPath` on: the characteristic of its variant, W without one. */
export const castCharacteristic = (state: SheetSignals, powerPath: string) => spellVariant(state, powerPath)?.test ?? "W";

/** Whether the caster prepares the spells of the day: a variant ticked prepares. */
export const preparesBySpellcasting = (state: SheetSignals) => tickedVariants(state).some(v => v.prepares);

export interface PoolBase {
    /** The base of the pool's max by the rules: the formula of its variant, "0" with none ticked. */
    base: string;
    /** Where it comes from, each variant ticked with what its formula comes to: "Arcane 14; Divine 12"; "" with none. */
    source: string;
}

const valueOf = (state: SheetSignals, variant: SpellcastingVariant) => resourceValue(state, variant.base, MANA_REFS) ?? 0;

/**
 * The base of `pool` by the rules, while its max is not typed: the mana the
 * largest formula of the PR variants ticked, a Focus its variant's while
 * ticked; "0" otherwise.
 */
export function poolBase(state: SheetSignals, pool: ManaPool): PoolBase {
    const stats = statsOf(state);
    const variants = pool === "mana" ? prVariants(state) : tickedVariants(state).filter(v => v === focusVariant(stats, pool));
    if (variants.length === 0) return { base: "0", source: "" };
    const values = variants.map(v => ({ variant: v, value: valueOf(state, v) }));
    // The first of equal ones, in the kind's order.
    const largest = values.reduce((best, v) => (v.value > best.value ? v : best));
    return { base: largest.variant.base, source: values.map(v => `${v.variant.label} ${v.value}`).join("; ") };
}

export interface PRCap {
    /** The characteristic of the largest bonus among those of the PR variants ticked. */
    characteristic: string;
    bonus: number;
}

/**
 * How far the PR grows (wiki «iii продвижение › таланты › магия › Power
 * Rating»): up to the bonus of the casting characteristic, the largest of the
 * PR variants ticked; null with none ticked.
 */
export function prCap(state: SheetSignals): PRCap | null {
    const caps = [...new Set(prVariants(state).map(v => v.test!))].map(characteristic => ({ characteristic, bonus: characteristicBonus(state, characteristic) }));
    return caps.length ? caps.reduce((best, c) => (c.bonus > best.bonus ? c : best)) : null;
}

/** «PR grows up to I.b (4)» while the base PR is past the cap; null otherwise. */
export function prCapWarning(state: SheetSignals): string | null {
    const cap = prCap(state);
    return cap && numberAt(state, "psykana.basePR") > cap.bonus ? `PR grows up to ${cap.characteristic}.b (${cap.bonus})` : null;
}
