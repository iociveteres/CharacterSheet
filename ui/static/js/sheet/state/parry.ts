// Parry with a melee weapon (rulebook «II. Механика › Бой», Баланс): the
// Parry skill, the modifier of the weapon's Balance, +15 of Defensive, the
// WS of its grip and its own modifiers (parryMods), expressions as the damage
// modifiers are without dice, as "+3×bPR" of a force staff. Balance −2 cannot
// parry: the sheet only says so. Reactive when read inside a computed.
import { addTerms, emptySum, parseDamage } from "../damage";
import { signed } from "../system";
import type { SheetSignals } from "../schema/sheet";
import { WEAPON_DAMAGE } from "./damage";
import { idsInOrder } from "./gridOrder";
import { attackHasProperty, balanceAt, heldGrip, type BreakdownLine } from "./melee";
import { getRollValue, rollBonusSuccesses } from "./rollBase";
import { textAt, valueAt } from "./sync";

/** The skill a weapon parries with, by its key in the skill tables. */
export const PARRY_SKILL = "parry";

/** What the Balance gives the tests with the weapon; null for −2, which cannot parry. */
export const BALANCE_MODIFIERS: { [balance: number]: number | null } = { [-2]: null, [-1]: -10, 0: 0, 1: 10, 2: 15 };

export interface Parry {
    /** Whether the weapon can parry: not at Balance −2. */
    canParry: boolean;
    /** What a Parry with it is tested against; without the Balance's modifier when it cannot parry. */
    value: number;
    lines: BreakdownLine[];
    /** What the row shows: the value, or "—" when it cannot parry. */
    text: string;
}

/** What the parry modifier `expr` adds; null when it reads as no number. */
export function parryModValue(state: SheetSignals, attackPath: string, expr: string): number | null {
    const { keys, named, valueOf } = WEAPON_DAMAGE.refs(state, attackPath);
    const { terms, invalid } = parseDamage(expr, keys, named);
    if (invalid.length || !terms.length || terms.some(t => t.kind === "dice" || t.kind === "refDice")) return null;
    return addTerms(emptySum(), terms, valueOf).flat;
}

/** Parry with the melee attack at `attackPath`. */
export function parryAt(state: SheetSignals, attackPath: string): Parry {
    const skill = getRollValue(state, PARRY_SKILL);
    const characteristic = textAt(state, `skillsLeft.${PARRY_SKILL}.characteristic`) || textAt(state, `skillsRight.${PARRY_SKILL}.characteristic`) || "WS";
    const lines: BreakdownLine[] = [{ text: String(skill), label: `Parry (${characteristic})` }];
    let value = skill;
    const add = (n: number, label: string) => {
        value += n;
        lines.push({ text: signed(n), label });
    };

    const balance = balanceAt(state, attackPath).value ?? 0;
    const balanceMod = BALANCE_MODIFIERS[balance];
    if (balanceMod === null) lines.push({ text: "—", label: "Balance -2: cannot parry" });
    else if (balanceMod !== 0) add(balanceMod, `Balance ${balance}`);
    if (attackHasProperty(state, attackPath, "Defensive")) add(15, "Defensive");
    for (const ws of heldGrip(state, attackPath).effects.ws) add(ws.add, ws.label);
    const grid = `${attackPath}.parryMods.items`;
    for (const id of idsInOrder(state, grid)) {
        if (!valueAt(state, `${grid}.${id}.enabled`)) continue;
        const expr = textAt(state, `${grid}.${id}.expr`);
        const n = parryModValue(state, attackPath, expr);
        if (n !== null) add(n, expr.trim());
    }
    return { canParry: balanceMod !== null, value, lines, text: balanceMod === null ? "—" : String(value) };
}

/** The bonus successes of a Parry: those of the characteristic the skill is tested on. */
export const parryBonusSuccesses = (state: SheetSignals) => rollBonusSuccesses(state, PARRY_SKILL);
