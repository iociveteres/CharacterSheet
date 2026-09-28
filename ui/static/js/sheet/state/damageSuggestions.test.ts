import { describe, expect, it } from "vitest";
import { BLACK_CRUSADE_STATS } from "../schema/constants";
import { damageSuggestions, insertTerm, termAt, termParts } from "./damageSuggestions";

const VALUES: { [ref: string]: number } = { WS: 5, BS: 3, S: 4, bPR: 3 };
const valueOf = (ref: string) => VALUES[ref] ?? 0;
const suggest = (query: string | null) => damageSuggestions(BLACK_CRUSADE_STATS.characteristics, query, valueOf);
const labels = (query: string | null) => suggest(query).flatMap(g => g.options.map(o => (typeof o === "string" ? o : o.label)));
const values = (query: string | null) => suggest(query).flatMap(g => g.options.map(o => (typeof o === "string" ? o : o.value)));

describe("the term at the caret", () => {
    it("is the text between signs, without the spaces next to them", () => {
        expect(termAt("S.b + 1/2 WS.b", 13)).toBe("1/2 WS.b");
        expect(termAt("S.b + 1/2 WS.b", 2)).toBe("S.b");
        expect(termAt("1d10–½W", 7)).toBe("½W");
        expect(termAt("S.b + ", 6)).toBe("");
    });

    it("is replaced by a pick once typed, else the pick is added", () => {
        expect(insertTerm("S.b + ½W", 8, "½WS.b", true)).toBe("S.b + ½WS.b");
        expect(insertTerm("s + 2", 1, "S.b", true)).toBe("S.b + 2");
        expect(insertTerm("S.b", 3, "1d10", false)).toBe("S.b+1d10");
        expect(insertTerm("S.b + ", 6, "1d10", false)).toBe("S.b+1d10");
        expect(insertTerm("", 0, "S.b", false)).toBe("S.b");
    });
});

describe("damageSuggestions", () => {
    it("lists the bonuses, the base psy rating and dice with what they add on focus", () => {
        expect(suggest(null).map(g => g.label)).toEqual(["Characteristic bonus", "Psy rating", "Dice"]);
        expect(labels(null)).toContain("S.b — Strength bonus = 4");
        expect(labels(null)).toContain("bPR — base psy rating = 3");
        expect(values(null)).toEqual(expect.arrayContaining(["1d10", "1d5"]));
    });

    it("lists the characteristic of the typed key first", () => {
        expect(values("s")).toEqual(["S.b", "WS.b", "BS.b"]);
        expect(values("s.b")[0]).toBe("S.b");
    });

    it("keeps the factor typed before a reference", () => {
        expect(labels("½w")).toEqual(["½W.b — Willpower bonus = 0", "½WS.b — Weapon Skill bonus = 2"]);
        expect(values("1/2 bs")).toEqual(["1/2BS.b"]);
        // A whole number is a number of dice too.
        expect(values("2")).toEqual(expect.arrayContaining(["2×S.b", "2×bPR", "2d10", "2d5"]));
        expect(values("1")).toEqual(expect.arrayContaining(["S.b", "1d10"]));
        expect(values("2d")).toEqual(["2d10", "2d5"]);
    });

    it("offers to round up a part of a reference", () => {
        expect(suggest("½BS.b")[0]).toEqual({
            label: "Rounding",
            options: [{ value: "½BS.b▲", label: "½BS.b▲ — round up = 2" }, { value: "½BS.b▼", label: "½BS.b▼ — round down = 1" }],
        });
        expect(suggest("½BS.b▲").map(g => g.label)).not.toContain("Rounding");
        expect(suggest("2×BS.b").map(g => g.label)).not.toContain("Rounding");
    });

    it("has nothing for a term that can become nothing", () => {
        expect(suggest("zz")).toEqual([]);
        expect(suggest("½1d")).toEqual([]);
    });
});

describe("termParts", () => {
    it("marks the invalid terms without the spaces around them", () => {
        expect(termParts("S.b + Ag.b - 2", ["Ag.b"])).toEqual([
            { text: "S.b ", marked: false }, { text: "+", marked: false },
            { text: " ", marked: false }, { text: "Ag.b", marked: true }, { text: " ", marked: false },
            { text: "-", marked: false }, { text: " 2", marked: false },
        ]);
    });
});
