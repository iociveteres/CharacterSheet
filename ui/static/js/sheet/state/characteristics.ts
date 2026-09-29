// The characteristics of the open sheet as the rules count them.
import { calculateCharacteristicBase } from "../system";
import { characterState } from "./state";

/** The bonus of characteristic `key` (S.b, I.b): its tens and its unnatural; 0 for none. Reactive. */
export function characteristicBonus(key: string): number {
    const char = characterState.characteristics?.[key];
    return char ? calculateCharacteristicBase(Number(char.calculatedValue?.value) || 0, Number(char.calculatedUnnatural?.value) || 0) : 0;
}
