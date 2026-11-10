// The characteristics of a sheet as the rules count them.
import { calculateCharacteristicBase } from "../system";
import type { SheetSignals } from "../schema/sheet";

/** The characteristics of the sheet, by key. */
export const characteristicKeys = (state: SheetSignals): string[] => Object.keys(state.characteristics ?? {});

/**
 * The bonus of characteristic `key` (S.b, I.b): its tens and its unnatural; 0
 * for none. `plus` changes the characteristic first, as the quality of a tech
 * power's hardware does its I. Reactive.
 */
export function characteristicBonus(state: SheetSignals, key: string, plus = 0): number {
    const char = state.characteristics?.[key];
    return char ? calculateCharacteristicBase((Number(char.calculatedValue?.value) || 0) + plus, Number(char.calculatedUnnatural?.value) || 0) : 0;
}
