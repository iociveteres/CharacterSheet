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

/** A caster of the Spellcasting variant `variant` with I 30, base PR 2 and a spell prepared in each tab, one of them sustained. */
const content = (variant: string, over: object = {}) => ({
    characteristics: { I: { value: "30" } },
    spellcasting: { [variant]: true },
    psykana: {
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
    it("are counted for a caster of Arcane or Divine Spellcasting while the rule is on", () => {
        expect(["arcane", "divine", "spontaneous", "bard", "ranger"].map(variant => preparing(load(content(variant)))))
            .toEqual([true, true, false, false, false]);
        // Spontaneous with Arcane: a variant that prepares is enough.
        expect(preparing(load(content("spontaneous", { spellcasting: { spontaneous: true, arcane: true } })))).toBe(true);
        expect(preparing(load(content("divine", { settings: { psykana: { prepared: false } } })))).toBe(false);
        expect(preparing(load(content("none")))).toBe(false);
    });

    it("are never counted on a Black Crusade sheet", () => {
        const state = load(content("divine", { psykana: { ...content("divine").psykana, psykanaType: "Bound" } }), blackCrusade);
        expect(preparing(state)).toBe(false);
        expect(preparedCount(state)).toBe(0);
    });

    it("are as many as marked in all tabs, up to I.b + the base PR", () => {
        const state = load(content("divine"));
        expect([preparedCount(state), preparedLimit(state)]).toEqual([2, 5]);
        updateSignalAtPath(state, `${spell("t1", "s2")}.prepared`, true);
        updateSignalAtPath(state, "psykana.basePR", 4);
        expect([preparedCount(state), preparedLimit(state)]).toEqual([3, 7]);
    });

    it("are all unprepared at once, one change for each, the sustained one still sustained", () => {
        const state = load(content("arcane"));
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
