// What makes up the distance of a movement mode, line by line for its title,
// as characteristicSummary.ts does for a characteristic.
import type { SheetSignals } from "../schema/sheet";
import { signed } from "../components/format";
import { MOVEMENT_REFS, addTerms, emptySum, parseDamage } from "../rolls/damageExpression";
import { characteristicKeys } from "../characteristics/characteristicRules";
import { addedLines } from "../characteristics/characteristicSummary";
import { collectEntries } from "../modifiers/entries";
import { textAt } from "../core/sync";
import { MIN_SPD, conditionsSpd, modeDistance, modeMult, modeName, modeSpd, movementRefValue, spdProblem, spdValue, type MoveColumn } from "./movement";

/** The terms of `expr` with what each adds: "A.b +3", "Size +1", "+2" for a number; those adding 0 left out, as Size 0. */
function termLines(state: SheetSignals, expr: string): string[] {
    const keys = characteristicKeys(state);
    let sign = "";
    return expr.replace(/[–—−]/g, "-").split(/([+-])/).flatMap((part, i) => {
        if (i % 2 === 1) {
            sign = part === "-" ? (sign === "-" ? "" : "-") : sign;
            return [];
        }
        const term = part.trim();
        if (!term) return [];
        const own = sign;
        sign = "";
        const { terms } = parseDamage(`${own}${term}`, keys, MOVEMENT_REFS);
        const value = addTerms(emptySum(), terms, ref => movementRefValue(state, ref)).flat;
        if (value === 0) return [];
        return [terms.some(t => t.kind === "ref") ? `${term} ${signed(value)}` : signed(value)];
    });
}

/**
 * What makes up the distance of `column` of the mode at `modePath`, line by
 * line for its title: the SPD times the multiplier, the terms of the SPD and
 * what the conditions add, each named by its condition or item.
 */
export function movementSummary(state: SheetSignals, modePath: string, column: MoveColumn): string[] {
    const header = `${modeName(state, modePath)}: ${column.label} ${modeDistance(state, modePath, column)}`;
    const expr = textAt(state, `${modePath}.spd`);
    const problem = spdProblem(state, expr);
    if (problem) return [header, `${problem}. Set the SPD under ⚙`];

    const spd = modeSpd(state, modePath)!;
    const mult = modeMult(state, modePath, column);
    const raw = spdValue(state, expr)! + conditionsSpd(state);
    const terms = termLines(state, expr);
    const conditions = addedLines(collectEntries(state, "movement_bonus"), "movementBonus");
    return [
        header,
        ...(mult !== 1 ? [`SPD ${spd} × ${mult}`] : []),
        // A lone number, as "6" of Flyer (6), is the SPD itself.
        ...(terms.length === 1 && !conditions.length && /^[+-]?\d/.test(terms[0]) ? [] : terms),
        ...conditions,
        ...(raw !== spd ? [`SPD ${raw} counts as ${MIN_SPD}`] : []),
    ];
}
