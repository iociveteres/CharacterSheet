// Rolls the sheet asks the room for. room/remote.ts listens on document,
// posts the roll to the chat and answers a d100 test with sheet:rollResult.
import { nanoid } from "nanoid";
import type { VersusOutcome } from "../room/messages";
import { onSheetTeardown } from "./lifecycle";
import { characterState } from "./state/state";
import { calculateBonusSuccesses } from "./system";

export type { VersusOutcome };

const pending = new Map<string, (outcome: VersusOutcome | null) => void>();

document.addEventListener("sheet:rollResult", e => {
    const { requestId, outcome } = (e as CustomEvent<{ requestId: string; outcome: VersusOutcome | null }>).detail;
    pending.get(requestId)?.(outcome);
    pending.delete(requestId);
});

// A test of a sheet that is gone comes to nothing.
function dropPending(): void {
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
}

/**
 * A d100 test against `target`; each two points of unnatural add a success.
 * Resolves with what the test came to once its message is back from the
 * server, or null when it is no single test or the sheet is closed first.
 */
export function rollVersus(target: number, bonusSuccesses: number, label: string): Promise<VersusOutcome | null> {
    const requestId = nanoid();
    const outcome = new Promise<VersusOutcome | null>(resolve => {
        if (pending.size === 0) onSheetTeardown(dropPending);
        pending.set(requestId, resolve);
    });
    document.dispatchEvent(new CustomEvent("sheet:rollVersus", {
        bubbles: true,
        detail: { target, bonusSuccesses, label, requestId },
    }));
    return outcome;
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
