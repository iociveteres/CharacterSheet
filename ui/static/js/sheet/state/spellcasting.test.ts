import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet, testState } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { resolvePath, valueAt } from "./sync";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const POWERS = "psykana.tabs.items.t1.powers.items";

/** A sheet of `spells`, by id, in one tab. */
const content = (spells: Record<string, object>, over: object = {}) => ({
    characteristics: { I: { value: "40" }, W: { value: "30" }, P: { value: "20" }, F: { value: "35" } },
    psykana: {
        tabs: {
            items: { t1: { name: "Tab", powers: { items: spells, layouts: Object.fromEntries(Object.keys(spells).map((id, i) => [id, pos(i % 2, i >> 1)])) } } },
            layouts: { t1: pos(0, 0) },
        },
    },
    ...over,
});

function load(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
    return testState();
}

afterEach(teardownSheet);

const keys = (path: string) => Object.keys(resolvePath(testState(), path) as object);

describe("the data of Spellcasting", () => {
    it("is a checkbox per variant, a Focus per half-caster class and the variant of a spell's roll in Pathfinder Crusade", () => {
        const state = load(content({ s1: { name: "Bolt", roll: { spellcasting: "divine" } } }, {
            spellcasting: { arcane: true, bard: true },
            focus: { bard: { current: 2, max: { base: "4" } } },
        }));
        expect(pathfinderCrusade.stats.spellcasting.map(v => v.key)).toEqual(["arcane", "divine", "spontaneous", "bard", "ranger"]);
        expect(keys("spellcasting")).toEqual(["arcane", "divine", "spontaneous", "bard", "ranger"]);
        expect(["arcane", "divine", "bard"].map(key => valueAt(state, `spellcasting.${key}`))).toEqual([true, false, true]);
        expect(keys("focus")).toEqual(["bard", "ranger"]);
        expect([valueAt(state, "focus.bard.current"), valueAt(state, "focus.bard.max.base"), valueAt(state, "focus.ranger.current")]).toEqual([2, "4", 0]);
        expect(valueAt(state, `${POWERS}.s1.roll.spellcasting`)).toBe("divine");
    });

    it("offers no Daemonic gift in Pathfinder Crusade", () => {
        expect(pathfinderCrusade.stats.psykanaTypes).toEqual(["Arcane", "Bound", "Unbound"]);
        expect(blackCrusade.stats.psykanaTypes).toContain("Daemonic");
    });

    it("is none of a Black Crusade sheet", () => {
        const state = load(content({ s1: { name: "Bolt", roll: { spellcasting: "divine" } } }, {
            spellcasting: { arcane: true }, focus: { bard: { current: 2 } },
        }), blackCrusade);
        expect(blackCrusade.stats.spellcasting).toEqual([]);
        expect(["spellcasting" in state, "focus" in state]).toEqual([false, false]);
        expect(keys(`${POWERS}.s1.roll`)).not.toContain("spellcasting");
    });
});
