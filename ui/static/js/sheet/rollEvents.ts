// Rolls the sheet asks the room for. room/dice.js listens on document and
// posts the roll to the chat.
import { characterState } from "./state/state";
import { calculateBonusSuccesses } from "./system";

/** A d100 test against `target`; each two points of unnatural add a success. */
export function rollVersus(target: number, bonusSuccesses: number, label: string): void {
    document.dispatchEvent(new CustomEvent("sheet:rollVersus", {
        bubbles: true,
        detail: { target, bonusSuccesses, label },
    }));
}

/** A dice expression such as "2d10+3". */
export function rollExact(expression: string, label: string): void {
    document.dispatchEvent(new CustomEvent("sheet:rollExact", {
        bubbles: true,
        detail: { expression, label },
    }));
}

/** Bonus successes of a test on characteristic `key`. */
export function bonusSuccessesOf(key: string): number {
    return calculateBonusSuccesses(characterState.characteristics?.[key]?.calculatedUnnatural?.value ?? 0);
}
