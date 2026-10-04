// What the encounter reads of a participant's sheet. The sheet counts it:
// the encounter only reads its signals, and they subscribe as valueAt does.
import type { SheetInstance } from "../../sheet/instance";
import { numberAt } from "../../sheet/state/sync";
import { characteristicBonus } from "../../sheet/state/characteristics";
import { sumEntryField } from "../../sheet/state/computed";
import { woundsLeft } from "../../sheet/state/armour";

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

/** The character name the sheet has now. */
export function nameOf({ state }: SheetInstance): string {
    return String(state.characterInfo?.characterName?.value ?? "");
}
