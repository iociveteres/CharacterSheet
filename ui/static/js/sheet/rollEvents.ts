// Rolls the sheet asks the room for. room/dice.js listens on document and
// posts the roll to the chat.
import { characterState } from "./state/state.js";
import { calculateBonusSuccesses } from "./system";
import type { Signal } from "@preact/signals-core";

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

type Characteristic = { calculatedValue?: Signal<number>; calculatedUnnatural?: Signal<number> };

/** Bonus successes of a test on characteristic `key`. */
export function bonusSuccessesOf(key: string): number {
    const chars = (characterState as { characteristics?: { [key: string]: Characteristic } }).characteristics;
    return calculateBonusSuccesses(chars?.[key]?.calculatedUnnatural?.value ?? 0);
}
