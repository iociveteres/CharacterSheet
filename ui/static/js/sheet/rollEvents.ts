// Rolls a sheet asks the room for. room/remote.ts listens on document, posts
// the roll to the chat signed as the event says and answers with
// sheet:rollResult once its message is back. Each sheet has its own rolls: a
// roll is signed by the sheet it comes from, and its result goes back to it.
import { nanoid } from "nanoid";
import type { VersusOutcome } from "../room/messages";
import type { SheetScope } from "./lifecycle";
import type { SheetSignals } from "./schema/sheet";
import { calculateBonusSuccesses } from "./system";

export type { VersusOutcome };

/** What the room answers a roll with: the outcome of a d100 test, the result line of the chat message. */
export interface RollResult {
    requestId: string;
    outcome: VersusOutcome | null;
    commandResult: string | null;
}

// The rolls on their way, of every sheet: requestId → what resolves them.
const pending = new Map<string, (result: RollResult | null) => void>();

document.addEventListener("sheet:rollResult", e => {
    const result = (e as CustomEvent<RollResult>).detail;
    pending.get(result.requestId)?.(result);
    pending.delete(result.requestId);
});

/** "1d10+7 = 15" gives 15; null for a result without a total. */
export function totalOf(commandResult: string | null): number | null {
    const m = String(commandResult ?? "").match(/=\s*(-?\d+)\s*$/);
    return m ? parseInt(m[1], 10) : null;
}

export interface SheetRolls {
    /**
     * A d100 test against `target`; each two points of unnatural add a success.
     * Resolves with what the test came to once its message is back from the
     * server, or null when it is no single test or the sheet is gone first.
     * `requestId` names the test, for a caller that keeps it.
     */
    versus(target: number, bonusSuccesses: number, label: string, requestId?: string): Promise<VersusOutcome | null>;
    /** A dice expression such as "2d10+3"; resolves with its total, null when there is none or the sheet is gone. */
    exact(expression: string, label: string): Promise<number | null>;
}

/**
 * The rolls of sheet `sheetId`, signed with the character's name as it is
 * when rolled. The ones on their way when `scope` is torn down come to nothing.
 */
export function createSheetRolls(sheetId: string, state: SheetSignals, scope: SheetScope): SheetRolls {
    const mine = new Set<string>();
    scope.onTeardown(() => {
        for (const requestId of mine) {
            pending.get(requestId)?.(null);
            pending.delete(requestId);
        }
        mine.clear();
    });

    function ask(type: "sheet:rollVersus" | "sheet:rollExact", detail: object, requestId: string): Promise<RollResult | null> {
        const result = new Promise<RollResult | null>(resolve => {
            mine.add(requestId);
            pending.set(requestId, r => {
                mine.delete(requestId);
                resolve(r);
            });
        });
        const characterName = state.characterInfo?.characterName?.peek()?.trim() || null;
        document.dispatchEvent(new CustomEvent(type, {
            bubbles: true,
            detail: { ...detail, requestId, sheetID: sheetId, characterName },
        }));
        return result;
    }

    return {
        versus: (target, bonusSuccesses, label, requestId = nanoid()) =>
            ask("sheet:rollVersus", { target, bonusSuccesses, label }, requestId).then(r => r?.outcome ?? null),
        exact: (expression, label) =>
            ask("sheet:rollExact", { expression, label }, nanoid()).then(r => (r ? totalOf(r.commandResult) : null)),
    };
}

/** Bonus successes of a test on characteristic `key`. */
export function bonusSuccessesOf(state: SheetSignals, key: string): number {
    return calculateBonusSuccesses(state.characteristics?.[key]?.calculatedUnnatural?.value ?? 0);
}
