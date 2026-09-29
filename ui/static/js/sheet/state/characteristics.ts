// The characteristics of the open sheet as the rules count them.
import { calculateCharacteristicBase } from "../system";
import { characterState } from "./state";

/** The characteristics of the open sheet, by key. */
export const characteristicKeys = (): string[] => Object.keys(characterState.characteristics ?? {});

/**
 * The bonus of characteristic `key` (S.b, I.b): its tens and its unnatural; 0
 * for none. `plus` changes the characteristic first, as the quality of a tech
 * power's hardware does its I. Reactive.
 */
export function characteristicBonus(key: string, plus = 0): number {
    const char = characterState.characteristics?.[key];
    return char ? calculateCharacteristicBase((Number(char.calculatedValue?.value) || 0) + plus, Number(char.calculatedUnnatural?.value) || 0) : 0;
}
