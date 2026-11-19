// The movement modes of a sheet (MovementMode in Go), as Land or Flight: the
// SPD of each from its expression, which rolls/damageExpression.ts parses with Size and
// without dice, plus what the conditions add to every mode; SPD ≤ 0 counts as
// 0.5 m. Each distance is the SPD times its multiplier.
import { MOVEMENT_REFS, SIZE, addTerms, emptySum, parseDamage, type DamageTerm } from "../rolls/damageExpression";
import { characteristicKeys } from "../characteristics/characteristicRules";
import { sumEntryField } from "../modifiers/entries";
import { refValue } from "../rolls/resourceStat";
import { numberAt, textAt, valueAt } from "../core/sync";
import type { SheetSignals } from "../schema/sheet";
import { t } from "../../i18n";

/** The names a mode is suggested, in this order. */
export const MODE_NAMES = ["Land", "Flight", "Hover", "Burrow", "Swim", "Climb"] as const;

/**
 * The labels of MODE_NAMES. The name stays English in the sheet, as the Land
 * the server writes into a new one, and is translated where it is shown.
 */
export const MODE_LABELS: { readonly [name: string]: string } = {
    Land: t("sheet.combat.movement.modeName.land"),
    Flight: t("sheet.combat.movement.modeName.flight"),
    Hover: t("sheet.combat.movement.modeName.hover"),
    Burrow: t("sheet.combat.movement.modeName.burrow"),
    Swim: t("sheet.combat.movement.modeName.swim"),
    Climb: t("sheet.combat.movement.modeName.climb"),
};

/** What SPD ≤ 0 counts as, in metres. */
export const MIN_SPD = 0.5;

/** The distances of a mode: its computed output, the multiplier of SPD it counts and what that is by the rules. */
export const MOVE_COLUMNS = [
    { key: "half", mult: "halfMult", byDefault: 1, label: t("sheet.terms.move.half.short") },
    { key: "full", mult: "fullMult", byDefault: 2, label: t("sheet.terms.move.full.short") },
    { key: "charge", mult: "chargeMult", byDefault: 3, label: t("sheet.terms.move.charge") },
    { key: "run", mult: "runMult", byDefault: 6, label: t("sheet.terms.move.run") },
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
    if (!expr.trim()) return t("sheet.combat.movement.noSpd");
    const { terms, invalid } = parseDamage(expr, characteristicKeys(state), MOVEMENT_REFS);
    if (invalid.length) return t("sheet.combat.movement.unknown", { terms: invalid.join(", ") });
    if (terms.some(isDice)) return t("sheet.combat.movement.noDice");
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

/**
 * The name of the mode at `modePath` as shown, "Mode" while it has none. A
 * name of MODE_NAMES, as the Land every new sheet gets, is shown translated.
 */
export function modeName(state: SheetSignals, modePath: string): string {
    const name = textAt(state, `${modePath}.name`).trim();
    // Own keys only: a mode typed "constructor" is not a label of the prototype.
    if (Object.hasOwn(MODE_LABELS, name)) return MODE_LABELS[name];
    return name || t("sheet.combat.movement.mode");
}
