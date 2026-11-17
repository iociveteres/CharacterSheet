import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadState, testState } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { attachComputeds } from "../kinds/computed";
import { modeNameSuggestions, movementInsert, movementSuggestions, movementTraits } from "./movementSuggestions";
import { optionLabel, optionValue } from "../schema/constants";
import { installDictionary } from "../../i18n/testDictionary";

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
        expect(Object.keys(groups)).toEqual(["From traits", "Characteristic Bonus", "Size"]);
        expect(groups["From traits"]).toEqual(["6 — Flyer (6), size ignored", "4 — hoverer(4), size ignored", "+2 — Digitigrade (2), on foot"]);
        expect(groups.Size).toEqual(["Size — size of the character = -1"]);
        expect(groups["Characteristic Bonus"]).toContain("A.b — Agility bonus = 3");
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
            ["Modes", ["Land", "Burrow", "Swim", "Climb"]],
        ]);
        expect(modeNameSuggestions(testState(), "sw").flatMap(g => g.options.map(optionValue))).toEqual(["Swim"]);
    });

    it("lists every mode without traits", () => {
        withTraits();
        expect(modeNameSuggestions(testState(), null).map(g => [g.label, g.options.map(optionValue)]))
            .toEqual([["Modes", ["Land", "Flight", "Hover", "Burrow", "Swim", "Climb"]]]);
    });

    it("shows the names in the page's language and keeps them English", async () => {
        installDictionary("ru");
        vi.resetModules();
        const utils = await import("../components/testUtils");
        const suggestions = await import("./movementSuggestions");
        utils.loadState({ traits: { list: { items: { t0: { name: "Flyer (6)" }, t1: { name: "Hoverer (4)" } }, layouts: { t0: pos(0, 0), t1: pos(0, 1) } } } });
        const groups = suggestions.modeNameSuggestions(utils.testState(), null);
        expect(groups.map(g => [g.label, g.options.map(o => [optionValue(o), optionLabel(o)])])).toEqual([
            ["Из трейтов", [["Flight", "Полёт — из трейтов"], ["Hover", "Парение — из трейтов"]]],
            ["Режимы", [["Land", "Пешком"], ["Burrow", "Рытьё"], ["Swim", "Плавание"], ["Climb", "Лазание"]]],
        ]);
        // A query finds a mode by its label too.
        expect(suggestions.modeNameSuggestions(utils.testState(), "плав").flatMap(g => g.options.map(optionValue))).toEqual(["Swim"]);
    });
});
