// What the room and the bestiary use of the sheet: outside ui/static/js/sheet
// only tests import anything else (scripts/check-layers.mjs). The encounter
// reads and edits its participants' sheets through the functions below, so
// it knows no state paths or rules of the sheet.
import type { SheetInstance } from "./instance";
import { numberAt } from "./core/sync";
import { characteristicBonus } from "./characteristics/characteristicRules";
import { sumEntryField } from "./modifiers/entries";
import { woundsLeft } from "./gear/armourRules";
import { initiativeExpression, initiativeRollFor, initiativeTotal } from "./combat/initiative";

export { sheets, sheetsChanged, holdSheet, holdOnPage, releaseSheet, replaceSheet, type SheetInstance } from "./instance";
export { fetchSheet } from "./reload";
export type { SheetPayload } from "./payload";
export { renderSheetView, renderStatBlockView } from "./view";
export { useSheetView } from "./useSheetView";
export { editFailedNotice, sendToRoom } from "./network";

/** The character name the sheet has now. */
export function nameOf({ state }: SheetInstance): string {
    return String(state.characterInfo?.characterName?.value ?? "");
}

/** AgB and Ag, which break the ties of the turn order. */
export function agilityOf({ state }: SheetInstance): { agilityBonus: number; agility: number } {
    return { agilityBonus: characteristicBonus(state, "A"), agility: numberAt(state, "characteristics.A.calculatedValue") };
}

/**
 * The wounds of the sheet as the Armour block counts them: woundsCur is the
 * damage taken, which the ablative wounds take first.
 */
export function woundsOf({ state }: SheetInstance): { left: number; max: number; ablative: number; ablativeLeft: number; taken: number } {
    const max = numberAt(state, "armour.woundsMax");
    const ablative = sumEntryField(state, "ablative_wounds", "ablativeWounds");
    const taken = numberAt(state, "armour.woundsCur");
    return { ...woundsLeft(max, ablative, taken), max, ablative, taken };
}

/** Heals `heal` wounds, or takes them when negative, as an edit of the damage taken, which stays at 0 or more. */
export function healWounds(sheet: SheetInstance, heal: number): void {
    sheet.actions.change("armour.woundsCur", Math.max(0, woundsOf(sheet).taken - heal));
}

/** The initiative of the sheet, its roll plus its modifier now; null before a roll. Reading it subscribes. */
export const initiativeOf = ({ state }: SheetInstance): number | null => initiativeTotal(state);

/** The initiative roll of the sheet, "1d10+7"; "" when it has none. */
export const initiativeRollOf = ({ state }: SheetInstance): string => initiativeExpression(state);

/** Keeps an initiative of `total`, as if the sheet had rolled it. */
export function setInitiative(sheet: SheetInstance, total: number): void {
    sheet.actions.change("initiative.lastInitiative", initiativeRollFor(sheet.state, total));
}

/** Clears the sheet's initiative, without an edit when it has none. */
export function clearInitiative(sheet: SheetInstance): void {
    if (Number(sheet.state.initiative?.lastInitiative?.peek())) sheet.actions.change("initiative.lastInitiative", 0);
}
