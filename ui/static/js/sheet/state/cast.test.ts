import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState, recordingActions } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { castPower, type Cast } from "./cast";
import { attachComputeds } from "./computed";
import { characterState } from "./state";
import { valueAt } from "./sync";

const P = "psykana.tabs.items.t1.powers.items.p1";
const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

beforeEach(() => {
    loadState({
        psykana: {
            basePR: 5,
            tabs: {
                items: { t1: { name: "Tab", powers: { items: { p1: { name: "Shield", sustained: "Free action" } }, layouts: { p1: pos(0, 0) } } } },
                layouts: { t1: pos(0, 0) },
            },
        },
    });
    attachComputeds(characterState);
});

afterEach(() => teardownSheet());

const cast = (over: Partial<Cast> = {}): Cast =>
    ({ effectivePR: 3, kick: 0, safe: false, target: 50, bonusSuccesses: 0, label: "Shield", sustain: { free: false }, ...over });

/** Casts with `over`; returns the cast's promise and its test's requestId. */
function send(over: Partial<Cast> = {}): { done: Promise<void>; requestId: string } {
    let requestId = "";
    const listener = (e: Event) => { requestId = (e as CustomEvent).detail.requestId; };
    document.addEventListener("sheet:rollVersus", listener);
    const done = castPower(recordingActions(), P, cast(over));
    document.removeEventListener("sheet:rollVersus", listener);
    return { done, requestId };
}

function answer(requestId: string, outcome: { roll: number; success: boolean; doubles: boolean }): void {
    document.dispatchEvent(new CustomEvent("sheet:rollResult", {
        detail: { requestId, outcome: { target: 50, degrees: 1, crit: false, ...outcome } },
    }));
}

describe("castPower", () => {
    it("records the cast before its test is back and sustains the power once it succeeds", async () => {
        const { done, requestId } = send({ kick: 1 });
        expect([valueAt(`${P}.cast.pr`), valueAt(`${P}.cast.kick`), valueAt("psykana.lastCastPower")]).toEqual([4, 1, "p1"]);
        // Pushed: phenomena whatever the test.
        expect(valueAt(`${P}.cast.phenomena`)).toBe("pushed");
        expect(valueAt(`${P}.sustain.copies`)).toBe(0);

        answer(requestId, { roll: 20, success: true, doubles: false });
        await done;
        expect([valueAt(`${P}.sustain.copies`), valueAt(`${P}.sustain.pr`)]).toEqual([1, 4]);
    });

    it("leaves the sustaining alone when the test fails or the cast is not to be sustained", async () => {
        const failed = send();
        answer(failed.requestId, { roll: 70, success: false, doubles: false });
        await failed.done;
        expect(valueAt(`${P}.sustain.copies`)).toBe(0);

        const unsustained = send({ sustain: null });
        answer(unsustained.requestId, { roll: 22, success: true, doubles: true });
        await unsustained.done;
        expect(valueAt(`${P}.sustain.copies`)).toBe(0);
        expect(valueAt(`${P}.cast.phenomena`)).toBe("doubles");
    });
});
