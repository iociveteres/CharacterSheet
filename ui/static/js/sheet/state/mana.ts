// The mana of Pathfinder Crusade (wiki «v магия › механика › Режим › Мана»):
// the trait Caster of the class gives the maximum, a cast spends its
// effective PR, kick included, before its test, and none is restored while a
// spell is sustained. Rest and meditation restore it: the sheet has a button
// to the maximum, the player types the rest. A sustained Upkeep (X) spell costs
// X at the start of each turn: a button pays it, as the sheet knows no turns.
// Sorcery spells are not paid with mana but with the Focus of their class, a
// pool each (focus.bard, state/sorcery.ts): each pool counts only its spells.
import { untracked } from "@preact/signals-core";
import type { SheetOps } from "./actions";
import { spend } from "./cast";
import { psykanaRule, sustainedPowers, sustaining, type SustainedPower } from "./psychic";
import { focusVariant, sorceryPool, sorcerySustained } from "./sorcery";
import { BASE_PR } from "../damage";
import { exprStat, type ResourceStatValue } from "./resourceStat";
import { statsOf } from "./state";
import { numberAt, valueAt } from "./sync";
import type { StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

/** The pool a spell casts with: PR spells "mana", Sorcery spells the Focus of their class, "focus.bard". */
export type ManaPool = "mana" | `focus.${string}`;

/** The mana left in `pool`. */
export const currentOf = (pool: ManaPool) => `${pool}.current`;

export const MANA = currentOf("mana");

/** What `pool` is called in the sheet: Mana, Bardic Focus. */
export const poolName = (stats: StatSet, pool: ManaPool) => (pool === "mana" ? "Mana" : focusVariant(stats, pool)?.pool ?? pool);

/** `pool` in a sentence: mana, Bardic Focus. */
export const poolNoun = (stats: StatSet, pool: ManaPool) => (pool === "mana" ? "mana" : poolName(stats, pool));

/** What the expressions of the maximum name besides characteristic bonuses: the base PR. */
export const MANA_REFS: readonly string[] = [BASE_PR];

/** The maximum; an empty base is 0, as the class gives it. */
export const manaMax = (state: SheetSignals, pool: ManaPool = "mana"): ResourceStatValue => exprStat(state, `${pool}.max`, "0", MANA_REFS);

/** Whether casts spend mana, and Sorcery ones their Focus: unless the settings turn it off. */
export const manaRule = (state: SheetSignals) => !!valueAt(state, "settings.psykana.mana");

/** Why a cast that costs `cost` cannot be paid from `pool`; null when it can, or casts spend none. */
export function manaShortage(state: SheetSignals, cost: number, pool: ManaPool = "mana"): string | null {
    const left = numberAt(state, currentOf(pool));
    return manaRule(state) && cost > left ? `Not enough ${poolNoun(statsOf(state), pool)}: the cast costs ${cost}, ${left} left` : null;
}

export function payMana(sheet: Pick<SheetOps, "state" | "actions">, cost: number, pool: ManaPool = "mana") {
    if (untracked(() => manaRule(sheet.state))) spend(sheet, currentOf(pool), cost);
}

/** The sustained spells `pool` pays for, as counted while the sheet marks them: the PR ones, or the Sorcery ones of its class. */
const sustainedOf = (state: SheetSignals, pool: ManaPool): SustainedPower[] => (pool === "mana"
    ? sustainedPowers(state).powers
    : sorcerySustained(state).powers.filter(p => sorceryPool(state, p.path) === pool));

/** What the sustained Upkeep spells of `pool` cost a turn; 0 while casts spend none or the sheet does not mark sustained ones. */
export const manaUpkeep = (state: SheetSignals, pool: ManaPool = "mana") =>
    manaRule(state) && psykanaRule(state, "sustained") ? sustainedOf(state, pool).reduce((sum, p) => sum + p.upkeep, 0) : 0;

/** Pays the upkeep of a turn; dispelling what it cannot pay is the player's call. */
export function payUpkeep(sheet: Pick<SheetOps, "state" | "actions">, pool: ManaPool = "mana") {
    spend(sheet, currentOf(pool), untracked(() => manaUpkeep(sheet.state, pool)));
}

/** Whether `pool` can be restored: not while a spell it pays for is sustained. */
export const canRestoreMana = (state: SheetSignals, pool: ManaPool = "mana") =>
    pool === "mana" ? !sustaining(state).any : sustainedOf(state, pool).length === 0;

/** Restores `pool` to its maximum; a value already past it stays. */
export function restoreMana({ state, actions }: Pick<SheetOps, "state" | "actions">, pool: ManaPool = "mana") {
    const [now, max] = untracked(() => [numberAt(state, currentOf(pool)), manaMax(state, pool).total]);
    actions.change(currentOf(pool), Math.max(now, max));
}
