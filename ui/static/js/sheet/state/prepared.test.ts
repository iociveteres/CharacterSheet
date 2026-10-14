import { afterEach, describe, expect, it } from "vitest";
import { loadState, recordingActions, teardownSheet, testState } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { preparedCount, preparedLimit, preparing, unprepareAll } from "./prepared";
import { updateSignalAtPath, valueAt } from "./sync";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const tab = (spells: Record<string, object>) => ({
    name: "Tab", powers: { items: spells, layouts: Object.fromEntries(Object.keys(spells).map((id, i) => [id, pos(0, i)])) },
});

/** A caster of `psykanaType` with I 30, base PR 2 and a spell prepared in each tab, one of them sustained. */
const content = (psykanaType: string, over: object = {}) => ({
    characteristics: { I: { value: "30" } },
    psykana: {
        psykanaType,
        basePR: 2,
        tabs: {
            items: {
                t1: tab({ s1: { name: "Bolt", prepared: true, sustain: { copies: 1, pr: 2 } }, s2: { name: "Ward" } }),
                t2: tab({ s3: { name: "Veil", prepared: true } }),
            },
            layouts: { t1: pos(0, 0), t2: pos(0, 1) },
        },
    },
    ...over,
});

function load(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
    return testState();
}

const spell = (tabId: string, id: string) => `psykana.tabs.items.${tabId}.powers.items.${id}`;

afterEach(() => teardownSheet());

describe("prepared spells", () => {
    it("are counted for an Arcane or Bound caster while the rule is on", () => {
        const gifts = pathfinderCrusade.stats.preparingGifts;
        expect(gifts).toEqual(["Arcane", "Bound"]);
        expect(["Arcane", "Bound", "Unbound", "Daemonic"].map(gift => preparing(load(content(gift)), gifts))).toEqual([true, true, false, false]);
        expect(preparing(load(content("Bound", { settings: { psykana: { prepared: false } } })), gifts)).toBe(false);
    });

    it("are never counted on a Black Crusade sheet", () => {
        const state = load(content("Bound"), blackCrusade);
        expect(blackCrusade.stats.preparingGifts).toEqual([]);
        expect(preparing(state, blackCrusade.stats.preparingGifts)).toBe(false);
        expect(preparedCount(state)).toBe(0);
    });

    it("are as many as marked in all tabs, up to I.b + the base PR", () => {
        const state = load(content("Bound"));
        expect([preparedCount(state), preparedLimit(state)]).toEqual([2, 5]);
        updateSignalAtPath(state, `${spell("t1", "s2")}.prepared`, true);
        updateSignalAtPath(state, "psykana.basePR", 4);
        expect([preparedCount(state), preparedLimit(state)]).toEqual([3, 7]);
    });

    it("are all unprepared at once, one change for each, the sustained one still sustained", () => {
        const state = load(content("Arcane"));
        const actions = recordingActions(state);
        unprepareAll({ state, actions });
        expect(preparedCount(state)).toBe(0);
        expect(actions.scheduled.map(([msg]) => msg)).toEqual([
            { type: "change", path: `${spell("t1", "s1")}.prepared`, change: false },
            { type: "change", path: `${spell("t2", "s3")}.prepared`, change: false },
        ]);
        expect(valueAt(state, `${spell("t1", "s1")}.sustain.copies`)).toBe(1);
    });
});
