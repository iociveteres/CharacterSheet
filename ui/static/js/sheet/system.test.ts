import { describe, expect, it } from "vitest";
import { parseCharacteristics } from "./system";

const KEYS = ["WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Inf", "Cor"];
const parse = (name: string) => {
    const { keys, invalid } = parseCharacteristics(name, KEYS);
    return { keys: [...keys], invalid };
};

describe("parseCharacteristics", () => {
    it("picks the listed characteristics, whatever the case and separators", () => {
        expect(parse("WS")).toEqual({ keys: ["WS"], invalid: [] });
        expect(parse(" ws,bs  inf ")).toEqual({ keys: ["WS", "BS", "Inf"], invalid: [] });
    });

    it("picks all of them for Any and leaves out the excluded ones", () => {
        expect(parse("Any").keys).toEqual(KEYS);
        expect(parse("any -t, -COR").keys).toEqual(KEYS.filter(k => k !== "T" && k !== "Cor"));
        expect(parse("WS, BS -BS").keys).toEqual(["WS"]);
    });

    it("starts exclusions alone from Any", () => {
        expect(parse("-T").keys).toEqual(KEYS.filter(k => k !== "T"));
    });

    it("picks nothing for an empty name", () => {
        expect(parse("")).toEqual({ keys: [], invalid: [] });
        expect(parse(" , ")).toEqual({ keys: [], invalid: [] });
    });

    it("picks nothing when a token names no characteristic", () => {
        expect(parse("WS, BZ")).toEqual({ keys: [], invalid: ["BZ"] });
        expect(parse("Any - T")).toEqual({ keys: [], invalid: ["-"] });
        expect(parse("-Any").invalid).toEqual(["-Any"]);
    });
});
