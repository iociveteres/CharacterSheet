// What the encounter reads of a participant's sheet. The sheet counts it:
// the encounter only reads its signals, and they subscribe as valueAt does.
import type { SheetInstance } from "../../sheet/instance";
import { numberAt, peekAt } from "../../sheet/state/sync";
import { characteristicBonus } from "../../sheet/state/characteristics";
import { sumEntryField } from "../../sheet/state/computed";

/** The initiative of the sheet: its roll plus its modifier now; null when it has not rolled. */
export function initiativeOf({ state }: SheetInstance): number | null {
    const roll = numberAt(state, "initiative.lastInitiative");
    return roll ? roll + numberAt(state, "initiative.modifier") : null;
}

/** The roll to keep in the sheet for an initiative of `total`, less the modifier the sheet has now. */
export function rollFor({ state }: SheetInstance, total: number): number {
    return total - (Number(peekAt(state, "initiative.modifier")) || 0);
}

/** The initiative roll of the sheet, "1d10+7"; "" when it has none. */
export function initiativeExpression({ state }: SheetInstance): string {
    return String(peekAt(state, "initiative.initiative") ?? "").trim();
}

/** AgB and Ag, which break the ties of the turn order. */
export function agilityOf({ state }: SheetInstance): { agilityBonus: number; agility: number } {
    return { agilityBonus: characteristicBonus(state, "A"), agility: numberAt(state, "characteristics.A.calculatedValue") };
}

/**
 * The wounds of the sheet as the Armour block counts them: woundsCur is the
 * damage taken, ablative wounds add to the maximum.
 */
export function woundsOf({ state }: SheetInstance): { left: number; max: number; taken: number } {
    const max = numberAt(state, "armour.woundsMax") + sumEntryField(state, "ablative_wounds", "ablativeWounds");
    const taken = numberAt(state, "armour.woundsCur");
    return { left: max - taken, max, taken };
}

/** The character name the sheet has now. */
export function nameOf({ state }: SheetInstance): string {
    return String(state.characterInfo?.characterName?.value ?? "");
}
