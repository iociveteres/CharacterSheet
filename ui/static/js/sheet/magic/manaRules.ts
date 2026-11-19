// The mana of Pathfinder Crusade (wiki «v магия › механика › Режим › Мана»):
// the trait Caster of the class gives the maximum, a successful cast spends its
// effective PR, kick included, a failed one nothing, and none is restored while a
// spell is sustained. Rest and meditation restore it: the sheet has a button
// to the maximum, the player types the rest. A sustained Upkeep (X) spell costs
// X at the start of each turn: a button pays it, as the sheet knows no turns.
// Arts spells are not paid with mana but with the Focus of their class, a
// pool each (focus.bard, magic/artsRules.ts): each pool counts only its spells.
import { untracked } from "@preact/signals-core";
import { t } from "../../i18n";
import type { SheetOps } from "../core/actions";
import { spend } from "../powers/spend";
import { psykanaRule, sustainedPowers, type SustainedPower } from "./psychic";
import { allSustained, focusVariant, artsPool, artsSustained } from "./artsRules";
import { poolBase } from "./spellcastingRules";
import { BASE_PR } from "../rolls/damageExpression";
import { exprStat, type ResourceStatValue } from "../rolls/resourceStat";
import { sheetComputed, statsOf } from "../core/state";
import { numberAt, valueAt } from "../core/sync";
import type { StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import type { ManaPool } from "../components/kindParts";

/** The mana left in `pool`. */
export const currentOf = (pool: ManaPool) => `${pool}.current`;

export const MANA = currentOf("mana");

/**
 * What `pool` is called in the sheet: Mana, Bardic Focus. A sentence that
 * names the mana has a key of its own: Russian declines «мана», while a
 * Focus, «Фокус Барда», reads the same in it.
 */
export const poolName = (stats: StatSet, pool: ManaPool) => (pool === "mana" ? t("sheet.termsPf.magic.mana") : focusVariant(stats, pool)?.pool ?? pool);

/** What the expressions of the maximum name besides characteristic bonuses: the base PR. */
export const MANA_REFS: readonly string[] = [BASE_PR];

/** The maximum; an empty base is the one Spellcasting gives (magic/spellcastingRules.ts), 0 without. */
export const manaMax = (state: SheetSignals, pool: ManaPool = "mana"): ResourceStatValue =>
    exprStat(state, `${pool}.max`, poolBase(state, pool).base, MANA_REFS);

/** Whether casts spend mana, and Arts ones their Focus: unless the settings turn it off. */
export const manaRule = (state: SheetSignals) => !!valueAt(state, "settings.psykana.mana");

/**
 * The sustained spells of both ways as the sheet shows them, while it counts
 * them; null when it does not. Each power's pill reads it: one list per edit
 * for all of them.
 */
export const sustainedShown = sheetComputed(state => (psykanaRule(state, "sustained")
    ? { powers: allSustained(state), freeLimit: sustainedPowers(state).freeLimit, upkeepShown: manaRule(state) }
    : null));

/** Why a cast that costs `cost` cannot be paid from `pool`; null when it can, or casts spend none. */
export function manaShortage(state: SheetSignals, cost: number, pool: ManaPool = "mana"): string | null {
    const left = numberAt(state, currentOf(pool));
    if (!manaRule(state) || cost <= left) return null;
    return pool === "mana" ? t("sheet.magicPf.mana.shortage", { cost, left })
        : t("sheet.magicPf.mana.shortagePool", { pool: poolName(statsOf(state), pool), cost, left });
}

export function payMana(sheet: Pick<SheetOps, "state" | "actions">, cost: number, pool: ManaPool = "mana") {
    if (untracked(() => manaRule(sheet.state))) spend(sheet, currentOf(pool), cost);
}

/** The sustained spells `pool` pays for, as counted while the sheet marks them: the PR ones, or the Arts ones of its class. */
const sustainedOf = (state: SheetSignals, pool: ManaPool): SustainedPower[] => (pool === "mana"
    ? sustainedPowers(state).powers
    : artsSustained(state).powers.filter(p => artsPool(state, p.path) === pool));

/** What the sustained Upkeep spells of `pool` cost a turn; 0 while casts spend none or the sheet does not mark sustained ones. */
export const manaUpkeep = (state: SheetSignals, pool: ManaPool = "mana") =>
    manaRule(state) && psykanaRule(state, "sustained") ? sustainedOf(state, pool).reduce((sum, p) => sum + p.upkeep, 0) : 0;

/** Pays the upkeep of a turn; dispelling what it cannot pay is the player's call. */
export function payUpkeep(sheet: Pick<SheetOps, "state" | "actions">, pool: ManaPool = "mana") {
    spend(sheet, currentOf(pool), untracked(() => manaUpkeep(sheet.state, pool)));
}

/** Restores `pool` to its maximum; a value already past it stays. */
export function restoreMana({ state, actions }: Pick<SheetOps, "state" | "actions">, pool: ManaPool = "mana") {
    const [now, max] = untracked(() => [numberAt(state, currentOf(pool)), manaMax(state, pool).total]);
    actions.change(currentOf(pool), Math.max(now, max));
}
