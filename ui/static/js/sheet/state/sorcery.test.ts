import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet, testState } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { hasSorcery, isSorcery } from "./psychic";
import { resolvePath, valueAt } from "./sync";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const POWERS = "psykana.tabs.items.t1.powers.items";

/** A sheet of `spells`, by id, in one tab. */
const content = (spells: Record<string, object>, over: object = {}) => ({
    characteristics: { F: { value: "40" }, W: { value: "30" } },
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
}

afterEach(teardownSheet);

const keys = (path: string) => Object.keys(resolvePath(testState(), path) as object);

describe("the data of a Sorcery spell", () => {
    const delude = { name: "Delude", subtypes: "Sorcery (Bard)", level: 1, roll: { skill: "deceive", characteristic: "W", modifier: -10 } };

    it("is a level, a skill and a characteristic of its roll, and a pool of its own on a Pathfinder Crusade sheet", () => {
        load(content({ s1: delude }, { sorceryMana: { current: 2, max: { base: "F.b" } } }));
        expect(valueAt(testState(), `${POWERS}.s1.level`)).toBe(1);
        expect(valueAt(testState(), `${POWERS}.s1.roll.skill`)).toBe("deceive");
        expect(valueAt(testState(), `${POWERS}.s1.roll.characteristic`)).toBe("W");
        // The fields of the shared roll stay.
        expect(valueAt(testState(), `${POWERS}.s1.roll.modifier`)).toBe(-10);
        expect(valueAt(testState(), "sorceryMana.current")).toBe(2);
        expect(valueAt(testState(), "sorceryMana.max.base")).toBe("F.b");

        load(content({ s1: { name: "Shield" } }));
        expect([valueAt(testState(), `${POWERS}.s1.level`), valueAt(testState(), "sorceryMana.current")]).toEqual([0, 0]);
    });

    it("is none of a Black Crusade sheet", () => {
        load(content({ s1: delude }, { sorceryMana: { current: 2 } }), blackCrusade);
        expect(keys(`${POWERS}.s1`)).not.toContain("level");
        expect(keys(`${POWERS}.s1.roll`)).not.toContain("skill");
        expect(keys(`${POWERS}.s1.roll`)).not.toContain("characteristic");
        expect("sorceryMana" in testState()).toBe(false);
    });
});

describe("the way of a spell", () => {
    const spells = { s1: { name: "Delude", subtypes: "Иллюзия, Sorcery (Bard)" }, s2: { name: "Shield", subtypes: "Колдовство" }, s3: { name: "Jump", subtypes: "Колдовство (Следопыт)" } };

    it("is Sorcery when its Subtypes name the type with a class, on a Pathfinder Crusade sheet", () => {
        load(content(spells));
        expect(hasSorcery(testState())).toBe(true);
        expect(["s1", "s2", "s3"].map(id => isSorcery(testState(), `${POWERS}.${id}`))).toEqual([true, false, true]);
    });

    it("is never Sorcery on a Black Crusade sheet, whatever the Subtypes say", () => {
        load(content(spells), blackCrusade);
        expect(hasSorcery(testState())).toBe(false);
        expect(["s1", "s2", "s3"].map(id => isSorcery(testState(), `${POWERS}.${id}`))).toEqual([false, false, false]);
    });
});
