import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, recordingActions, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { updateSignalAtPath, valueAt } from "../state/sync";
import { Coins } from "./Coins";

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;

const content = (coins: object) => ({
    gear: { list: { items: { g1: { name: "Rope", weight: 1.25, carried: true } }, layouts: { g1: { colIndex: 0, rowIndex: 0 } } } },
    coins,
});

describe("the coins of a Pathfinder Crusade sheet", () => {
    it("weigh 1 kg a hundred in the encumbrance, until turned off", () => {
        const state = loadState(content({ pp: 1, gp: 120, sp: 30, cp: 4 }), pathfinderCrusade);
        attachComputeds(state);
        expect(state.carryWeightAndEncumbrance.encumbrance.value).toBe(2.8);

        rendered = renderBlock(<Coins />);
        expect($('[data-id="coins"] [data-id="weight"]').value).toBe("1.55");

        act(() => updateSignalAtPath(state, "coins.countWeight", false));
        expect(state.carryWeightAndEncumbrance.encumbrance.value).toBe(1.25);
        expect($('[data-id="coins"] [data-id="weight"]').value).toBe("");
    });

    it("count their weight by default, are whole and turned off under the ⚙", () => {
        const state = loadState(content({ gp: 50 }), pathfinderCrusade);
        attachComputeds(state);
        expect(valueAt(state, "coins.countWeight")).toBe(true);

        const actions = recordingActions();
        rendered = renderBlock(<Coins />, { actions });
        const gp = $('[data-id="coins"] [data-id="gp"]');
        act(() => {
            gp.value = "12.6";
            gp.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(valueAt(state, "coins.gp")).toBe(13);

        act(() => $<HTMLButtonElement>('[data-id="coins"] .mod-toggle').click());
        act(() => $('[data-id="coins"] [data-id="countWeight"]').click());
        expect(valueAt(state, "coins.countWeight")).toBe(false);
        expect(state.carryWeightAndEncumbrance.encumbrance.value).toBe(1.25);
    });

    it("are none of a Black Crusade sheet", () => {
        const state = loadState(content({ gp: 500 }), blackCrusade);
        attachComputeds(state);
        expect(valueAt(state, "coins.gp")).toBeUndefined();
        expect(state.carryWeightAndEncumbrance.encumbrance.value).toBe(1.25);
    });
});
