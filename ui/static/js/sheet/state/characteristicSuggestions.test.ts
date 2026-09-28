import { describe, expect, it } from "vitest";
import { CHARACTERISTICS, optionValue } from "../schema/constants";
import { characteristicSuggestions, insertToken, tokenAt } from "./characteristicSuggestions";

const suggest = (text: string, query: string | null) =>
    characteristicSuggestions(CHARACTERISTICS, text, query).map(g => [g.label, g.options.map(optionValue)]);

const TESTED = ["WS", "BS", "S", "T", "A", "I", "P", "W", "F"];

describe("tokenAt", () => {
    it("takes the token around the caret, with its minus", () => {
        expect(tokenAt("WS, B", 5)).toBe("B");
        expect(tokenAt("WS, ", 4)).toBe("");
        expect(tokenAt("Any -T", 6)).toBe("-T");
        expect(tokenAt("WS, BS", 1)).toBe("WS");
    });
});

describe("insertToken", () => {
    it("adds the value as a new token before the player typed", () => {
        expect(insertToken("", 0, "WS", false)).toBe("WS");
        expect(insertToken("WS", 2, "BS", false)).toBe("WS, BS");
        expect(insertToken("WS, ", 4, "BS", false)).toBe("WS, BS");
    });

    it("replaces the token at the caret once the player typed", () => {
        expect(insertToken("WS, b", 5, "BS", true)).toBe("WS, BS");
        expect(insertToken("Any t", 5, "-T", true)).toBe("Any -T");
        expect(insertToken("W, BS", 1, "WS", true)).toBe("WS, BS");
        expect(insertToken("WS, ", 4, "BS", true)).toBe("WS, BS");
    });
});

describe("characteristicSuggestions", () => {
    it("offers Any and every characteristic for an empty name", () => {
        expect(suggest("", null)).toEqual([["All", ["Any"]], ["Characteristics", CHARACTERISTICS.map(c => c.key)]]);
        expect(characteristicSuggestions(CHARACTERISTICS, "", null)[0].options).toEqual([{ value: "Any", label: "Any — all but Inf and Cor" }]);
    });

    it("leaves out what the name has already", () => {
        expect(suggest("WS", null)[1]).toEqual(["Characteristics", CHARACTERISTICS.map(c => c.key).filter(k => k !== "WS")]);
        expect(suggest("WS, w", "w")).toEqual([["Characteristics", ["W"]]]);
    });

    it("keeps the token being typed among the options", () => {
        expect(suggest("w", "w")).toEqual([["Characteristics", ["WS", "W"]]]);
        expect(suggest("a", "a")).toEqual([["All", ["Any"]], ["Characteristics", ["A"]]]);
    });

    it("offers exclusions after Any, and the characteristics Any leaves out", () => {
        expect(suggest("Any", null)).toEqual([["Leave out", TESTED.map(k => `-${k}`)], ["Characteristics", ["Inf", "Cor"]]]);
        expect(suggest("Any -T", null)[0]).toEqual(["Leave out", TESTED.filter(k => k !== "T").map(k => `-${k}`)]);
        expect(suggest("Any t", "t")).toEqual([["Leave out", ["-T"]]]);
    });

    it("offers only exclusions for a token that starts with a minus", () => {
        expect(suggest("-", "-")).toEqual([["Leave out", TESTED.map(k => `-${k}`)]]);
        expect(suggest("Any -T, -w", "-w")).toEqual([["Leave out", ["-WS", "-W"]]]);
    });

    it("matches a word of the full name too", () => {
        expect(suggest("tough", "tough")).toEqual([["Characteristics", ["T"]]]);
    });
});
