import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet } from "../components/testUtils";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { rangeAt, rangeMod } from "./range";

afterEach(teardownSheet);

const A = "rangedAttacks.list.items.r1";

/** S 40, S.b 4; a ranged attack of `attack` with the modifiers `mods`. */
function range(attack: object, mods: string[] = []) {
    const state = loadState({
        characteristics: { S: { value: "40" } },
        rangedAttacks: { list: { items: { r1: { ...attack, rangeMods: {
            items: Object.fromEntries(mods.map((expr, i) => [`m${i}`, { expr, enabled: !expr.startsWith("off:") }])),
            layouts: Object.fromEntries(mods.map((_, i) => [`m${i}`, { colIndex: 0, rowIndex: i }])),
        } } }, layouts: { r1: { colIndex: 0, rowIndex: 0 } } } },
    }, pathfinderCrusade);
    attachComputeds(state);
    return rangeAt(state, A);
}

describe("the range of a ranged attack", () => {
    it("reads the rulebook's own, with its metres", () => {
        expect(range({ range: "S.b×10м" }).text).toBe("40м");
        expect(range({ range: "50м" }).text).toBe("50м");
        expect(range({ range: "3×S.b" }).text).toBe("12");
        expect(range({ range: "" }).text).toBe("");
    });

    it("is S.b×3 by the rules for a thrown weapon or grenade without one", () => {
        expect(range({ class: "grenade" })).toMatchObject({ text: "12м", byRule: true });
        expect(range({ class: "throwing", range: "S.b×5м" })).toMatchObject({ text: "20м", byRule: false });
        expect(range({ class: "pistol" })).toMatchObject({ text: "", byRule: false });
    });

    it("adds the terms of its modifiers, then multiplies by the factors, rounded down unless ▲", () => {
        expect(range({ range: "S.b×10м" }, ["×2"]).text).toBe("80м");
        expect(range({ class: "throwing", range: "S.b×3м" }, ["×1.5"]).text).toBe("18м");
        expect(range({ range: "25м" }, ["×1.5"]).text).toBe("37м");
        expect(range({ range: "25м" }, ["×1.5▲"]).text).toBe("38м");
        expect(range({ range: "25м" }, ["×2", "+5"]).text).toBe("60м");
        expect(range({ range: "10м" }, ["S.b", "off:×2"]).text).toBe("14м");
    });

    it("shows a range that reads as no number as typed, without the modifiers", () => {
        expect(range({ range: "30м [50м]" }, ["×2"])).toMatchObject({ text: "30м [50м]", baseValue: null });
    });
});

describe("a modifier of the range", () => {
    it("is a factor or a term, or nothing", () => {
        const state = loadState({ characteristics: { S: { value: "40" } } }, pathfinderCrusade);
        attachComputeds(state);
        expect(rangeMod(state, "×½")).toEqual({ expr: "×½", factor: 0.5, roundUp: false });
        expect(rangeMod(state, "x2")).toMatchObject({ factor: 2 });
        expect(rangeMod(state, "+5м")).toEqual({ expr: "+5м", add: 5 });
        expect(rangeMod(state, "2×S.b")).toEqual({ expr: "2×S.b", add: 8 });
        expect(rangeMod(state, "×")).toBeNull();
        expect(rangeMod(state, "1d10")).toBeNull();
    });
});
