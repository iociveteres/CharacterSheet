// The mana of Pathfinder Crusade (wiki «v магия › механика › Режим › Мана»):
// the trait Caster of the class gives the maximum, a cast spends its
// effective PR, kick included, before its test, and none is restored while a
// spell is sustained. Rest and meditation restore it: the sheet has a button
// to the maximum, the player types the rest. A sustained Upkeep (X) spell costs
// X at the start of each turn: a button pays it, as the sheet knows no turns.
// Sorcery spells have a pool of their own, sorceryMana (state/sorcery.ts):
// each pool counts only the spells of its way.
import { untracked } from "@preact/signals-core";
import type { SheetOps } from "./actions";
import { spend } from "./cast";
import { psykanaRule, sustainedPowers, sustaining } from "./psychic";
import { sorcerySustained } from "./sorcery";
import { BASE_PR } from "../damage";
import { exprStat, type ResourceStatValue } from "./resourceStat";
import { numberAt, valueAt } from "./sync";
import type { SheetSignals } from "../schema/sheet";

/** The pool of mana a spell casts with: PR spells "mana", Sorcery spells "sorceryMana". */
export type ManaPool = "mana" | "sorceryMana";

/** The mana left in `pool`. */
export const currentOf = (pool: ManaPool) => `${pool}.current`;

export const MANA = currentOf("mana");

/** What `pool` is called in the sheet. */
export const poolName = (pool: ManaPool) => (pool === "mana" ? "Mana" : "Halfcasting Mana");

/** What the expressions of the maximum name besides characteristic bonuses: the base PR. */
export const MANA_REFS: readonly string[] = [BASE_PR];

/** The maximum; an empty base is 0, as the class gives it. */
export const manaMax = (state: SheetSignals, pool: ManaPool = "mana"): ResourceStatValue => exprStat(state, `${pool}.max`, "0", MANA_REFS);

/** Whether casts spend mana, of both pools: unless the settings turn it off. */
export const manaRule = (state: SheetSignals) => !!valueAt(state, "settings.psykana.mana");

/** Why a cast that costs `cost` cannot be paid from `pool`; null when it can, or casts spend none. */
export function manaShortage(state: SheetSignals, cost: number, pool: ManaPool = "mana"): string | null {
    const left = numberAt(state, currentOf(pool));
    return manaRule(state) && cost > left ? `Not enough ${poolName(pool).toLowerCase()}: the cast costs ${cost}, ${left} left` : null;
}

export function payMana(sheet: Pick<SheetOps, "state" | "actions">, cost: number, pool: ManaPool = "mana") {
    if (untracked(() => manaRule(sheet.state))) spend(sheet, currentOf(pool), cost);
}

/** The spells of `pool`'s way that are sustained, as counted while the sheet marks them. */
const sustainedOf = (state: SheetSignals, pool: ManaPool) => (pool === "mana" ? sustainedPowers(state) : sorcerySustained(state));

/** The mana the sustained Upkeep spells of `pool` cost a turn; 0 while casts spend none or the sheet does not mark sustained ones. */
export const manaUpkeep = (state: SheetSignals, pool: ManaPool = "mana") =>
    manaRule(state) && psykanaRule(state, "sustained") ? sustainedOf(state, pool).upkeep : 0;

/** Pays the upkeep of a turn; dispelling what it cannot pay is the player's call. */
export function payUpkeep(sheet: Pick<SheetOps, "state" | "actions">, pool: ManaPool = "mana") {
    spend(sheet, currentOf(pool), untracked(() => manaUpkeep(sheet.state, pool)));
}

/** Whether `pool` can be restored: not while a spell of its way is sustained. */
export const canRestoreMana = (state: SheetSignals, pool: ManaPool = "mana") =>
    pool === "mana" ? !sustaining(state).any : sorcerySustained(state).count === 0;

/** Restores `pool` to its maximum; a value already past it stays. */
export function restoreMana({ state, actions }: Pick<SheetOps, "state" | "actions">, pool: ManaPool = "mana") {
    const [now, max] = untracked(() => [numberAt(state, currentOf(pool)), manaMax(state, pool).total]);
    actions.change(currentOf(pool), Math.max(now, max));
}
