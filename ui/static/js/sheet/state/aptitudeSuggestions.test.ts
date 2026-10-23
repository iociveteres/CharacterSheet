import { describe, expect, it } from "vitest";
import { BLACK_CRUSADE_STATS, optionValue } from "../schema/constants";
import { PATHFINDER_CRUSADE_STATS } from "../kinds/pathfinder_crusade";
import { aptitudeSuggestions } from "./aptitudeSuggestions";

const suggest = (text: string, query: string | null, general = false, stats = PATHFINDER_CRUSADE_STATS) =>
    aptitudeSuggestions(stats, text, query, general).map(g => [g.label, g.options.map(optionValue)]);

const CHARACTERISTICS = ["WS", "BS", "S", "T", "A", "I", "P", "W", "F"];

describe("aptitudeSuggestions", () => {
    it("lists the aptitudes of the kind, General only for an advancement", () => {
        expect(suggest("", null)).toEqual([
            ["Characteristics", CHARACTERISTICS],
            ["Specialisations", ["Off", "Fin", "Def", "Mag", "Tec", "Knw", "Soc", "FC"]],
        ]);
        expect(suggest("", null, true)[1][1]).toContain("Gen");
        expect(suggest("", null, false, BLACK_CRUSADE_STATS)[1][1]).toContain("Psi");
        expect(suggest("", null, false, BLACK_CRUSADE_STATS)[1][1]).not.toContain("Mag");
    });

    it("leaves out the aptitudes named, in any case", () => {
        expect(suggest("ws, Off, ", "")).toEqual([
            ["Characteristics", CHARACTERISTICS.filter(c => c !== "WS")],
            ["Specialisations", ["Fin", "Def", "Mag", "Tec", "Knw", "Soc", "FC"]],
        ]);
    });

    it("completes the token by the key or a word of the name, the token itself still offered", () => {
        expect(suggest("WS, F", "F")).toEqual([["Characteristics", ["F"]], ["Specialisations", ["Fin", "FC"]]]);
        expect(suggest("WS, mag", "mag")).toEqual([["Specialisations", ["Mag"]]]);
        expect(suggest("Off, Te", "TE")).toEqual([["Specialisations", ["Tec"]]]);
        expect(suggest("intel", "intel")).toEqual([["Characteristics", ["I"]]]);
        expect(suggest("WS", "x")).toEqual([]);
    });
});
