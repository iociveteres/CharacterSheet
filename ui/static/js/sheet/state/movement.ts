// The movement modes of a sheet (MovementMode in Go), as Land or Flight: the
// SPD of each from its expression, which damage.ts parses with Size and
// without dice, plus what the conditions add to every mode; SPD ≤ 0 counts as
// 0.5 m. Each distance is the SPD times its multiplier.
import { MOVEMENT_REFS, SIZE, addTerms, emptySum, parseDamage, type DamageTerm } from "../damage";
import { characteristicKeys } from "./characteristics";
import { sumEntryField } from "./computed";
import { refValue } from "./resourceStat";
import { numberAt, textAt, valueAt } from "./sync";
import type { SheetSignals } from "../schema/sheet";

/** What SPD ≤ 0 counts as, in metres. */
export const MIN_SPD = 0.5;

/** The distances of a mode: its computed output, the multiplier of SPD it counts and what that is by the rules. */
export const MOVE_COLUMNS = [
    { key: "half", mult: "halfMult", byDefault: 1, label: "Half" },
    { key: "full", mult: "fullMult", byDefault: 2, label: "Full" },
    { key: "charge", mult: "chargeMult", byDefault: 3, label: "Charge" },
    { key: "run", mult: "runMult", byDefault: 6, label: "Run" },
] as const;

export type MoveColumn = (typeof MOVE_COLUMNS)[number];

/** The value of a reference of a mode's SPD: the size of the sheet or a characteristic's bonus. */
export const movementRefValue = (state: SheetSignals, ref: string): number =>
    (ref === SIZE ? numberAt(state, "size") : refValue(state, ref));

const isDice = (t: DamageTerm) => t.kind === "dice" || t.kind === "refDice";

/** What the SPD expression `expr` comes to; null when it reads as no number: empty, unknown terms or dice. */
export function spdValue(state: SheetSignals, expr: string): number | null {
    const { terms, invalid } = parseDamage(expr, characteristicKeys(state), MOVEMENT_REFS);
    if (invalid.length || terms.length === 0 || terms.some(isDice)) return null;
    return addTerms(emptySum(), terms, ref => movementRefValue(state, ref)).flat;
}

/** Why the SPD expression `expr` reads as no number, null when it reads. */
export function spdProblem(state: SheetSignals, expr: string): string | null {
    if (!expr.trim()) return "No SPD";
    const { terms, invalid } = parseDamage(expr, characteristicKeys(state), MOVEMENT_REFS);
    if (invalid.length) return `Unknown: ${invalid.join(", ")}`;
    if (terms.some(isDice)) return "SPD takes no dice";
    return null;
}

/** What the conditions add to the SPD of every mode. */
export const conditionsSpd = (state: SheetSignals) => sumEntryField(state, "movement_bonus", "movementBonus");

/** The SPD of the mode at `modePath` that the distances count; null when its expression reads as no number. */
export function modeSpd(state: SheetSignals, modePath: string): number | null {
    const own = spdValue(state, textAt(state, `${modePath}.spd`));
    if (own === null) return null;
    const spd = own + conditionsSpd(state);
    return spd > 0 ? spd : MIN_SPD;
}

/** The multiplier of `column` of the mode at `modePath`: as typed, the rules' one for 0. */
export const modeMult = (state: SheetSignals, modePath: string, column: MoveColumn): number =>
    Number(valueAt(state, `${modePath}.${column.mult}`)) || column.byDefault;

/** A distance as the table shows it: up to two decimals, "—" for none. */
export const formatDistance = (n: number | null): string => (n === null ? "—" : String(Math.round(n * 100) / 100));

/** The distance of `column` of the mode at `modePath`, as shown. */
export function modeDistance(state: SheetSignals, modePath: string, column: MoveColumn): string {
    const spd = modeSpd(state, modePath);
    return formatDistance(spd === null ? null : spd * modeMult(state, modePath, column));
}

/** The name of the mode at `modePath`, "Mode" while it has none. */
export const modeName = (state: SheetSignals, modePath: string) => textAt(state, `${modePath}.name`).trim() || "Mode";
