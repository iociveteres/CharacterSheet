// The mana of Pathfinder Crusade (wiki «v магия › механика › Режим › Мана»):
// the trait Caster of the class gives the maximum, a cast spends its
// effective PR, kick included, before its test, and none is restored while a
// spell is sustained. Rest and meditation restore it: the sheet has a button
// to the maximum, the player types the rest.
import { untracked } from "@preact/signals-core";
import type { SheetOps } from "./actions";
import { spend } from "./cast";
import { sustaining } from "./psychic";
import { BASE_PR } from "../damage";
import { exprStat, type ResourceStatValue } from "./resourceStat";
import { numberAt, valueAt } from "./sync";
import type { SheetSignals } from "../schema/sheet";

export const MANA = "mana.current";

/** What the expressions of the maximum name besides characteristic bonuses: the base PR. */
export const MANA_REFS: readonly string[] = [BASE_PR];

/** The maximum; an empty base is 0, as the class gives it. */
export const manaMax = (state: SheetSignals): ResourceStatValue => exprStat(state, "mana.max", "0", MANA_REFS);

/** Whether casts spend mana: unless the settings turn it off. */
export const manaRule = (state: SheetSignals) => !!valueAt(state, "settings.psykana.mana");

/** Why a cast at `pr` cannot be paid; null when it can, or casts spend none. */
export function manaShortage(state: SheetSignals, pr: number): string | null {
    const left = numberAt(state, MANA);
    return manaRule(state) && pr > left ? `Not enough mana: the cast costs ${pr}, ${left} left` : null;
}

export function payMana(sheet: Pick<SheetOps, "state" | "actions">, pr: number) {
    if (untracked(() => manaRule(sheet.state))) spend(sheet, MANA, pr);
}

/** Whether mana can be restored: not while a spell is sustained. */
export const canRestoreMana = (state: SheetSignals) => !sustaining(state).any;

/** Restores the mana to its maximum; a value already past it stays. */
export function restoreMana({ state, actions }: Pick<SheetOps, "state" | "actions">) {
    const [now, max] = untracked(() => [numberAt(state, MANA), manaMax(state).total]);
    actions.change(MANA, Math.max(now, max));
}
