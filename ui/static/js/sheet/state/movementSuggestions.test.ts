import { beforeEach, describe, expect, it } from "vitest";
import { loadState, testState } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { attachComputeds } from "./computed";
import { modeNameSuggestions, movementInsert, movementSuggestions, movementTraits } from "./movementSuggestions";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

const withTraits = (...names: string[]) => {
    loadState({
        characteristics: { A: { value: "35" }, S: { value: "42" } },
        size: -1,
        traits: {
            list: {
                items: Object.fromEntries(names.map((name, i) => [`t${i}`, { name }])),
                layouts: Object.fromEntries(names.map((_, i) => [`t${i}`, pos(0, i)])),
            },
        },
    });
    attachComputeds(testState());
};

const labels = (query: string | null) =>
    Object.fromEntries(movementSuggestions(testState(), blackCrusade.stats.characteristics, query).map(g => [g.label, g.options.map(o => typeof o === "string" ? o : o.label)]));

beforeEach(() => withTraits("Flyer (6)", "hoverer(4)", "Digitigrade (2)", "Flyer (X)", "Quadruped (2)"));

describe("movementTraits", () => {
    it("reads the traits with a number that change how the sheet moves", () => {
        expect(movementTraits(testState()).map(t => [t.trait, t.value])).toEqual([["Flyer", 6], ["Hoverer", 4], ["Digitigrade", 2]]);
    });
});

describe("movementSuggestions", () => {
    it("leads with what the traits give, then the characteristics and Size, no dice", () => {
        const groups = labels(null);
        expect(Object.keys(groups)).toEqual(["From traits", "Characteristic bonus", "Size"]);
        expect(groups["From traits"]).toEqual(["6 — Flyer (6), size ignored", "4 — hoverer(4), size ignored", "+2 — Digitigrade (2), on foot"]);
        expect(groups.Size).toEqual(["Size — size of the character = -1"]);
        expect(groups["Characteristic bonus"]).toContain("A.b — Agility bonus = 3");
    });

    it("offers Size with a factor and the traits by name or number", () => {
        expect(labels("size")["With a factor"]).toEqual([
            "½Size — half, rounded down = -1", "½Size▲ — half, rounded up = 0", "2×Size — twice = -2", "3×Size — three times = -3",
        ]);
        expect(labels("fly")["From traits"]).toEqual(["6 — Flyer (6), size ignored"]);
        expect(labels("2")["From traits"]).toEqual(["+2 — Digitigrade (2), on foot"]);
    });

    it("puts in the SPD of a flyer in place of the expression, any other term as a term", () => {
        const insert = movementInsert(testState());
        expect(insert("A.b+Size", 8, "6", false)).toBe("6");
        expect(insert("A.b+Size", 8, "2", false)).toBe("A.b+Size+2");
        expect(insert("A.b+S", 5, "Size", true)).toBe("A.b+Size");
    });
});

describe("modeNameSuggestions", () => {
    it("lists the modes of the traits first, marked, then the rest", () => {
        const groups = modeNameSuggestions(testState(), null);
        expect(groups.map(g => [g.label, g.options.map(o => typeof o === "string" ? o : o.value)])).toEqual([
            ["From traits", ["Flight", "Hover"]],
            ["Modes", ["Move", "Burrow", "Swim", "Climb"]],
        ]);
        expect(modeNameSuggestions(testState(), "sw").flatMap(g => g.options)).toEqual(["Swim"]);
    });

    it("lists every mode without traits", () => {
        withTraits();
        expect(modeNameSuggestions(testState(), null)).toEqual([{ label: "Modes", options: ["Move", "Flight", "Hover", "Burrow", "Swim", "Climb"] }]);
    });
});
