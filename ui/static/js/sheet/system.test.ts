import { describe, expect, it } from "vitest";
import { parseCharacteristics } from "./system";

const KEYS = ["WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Inf", "Cor"];
const ANY = KEYS.slice(0, 9);
const parse = (name: string) => {
    const { keys, invalid } = parseCharacteristics(name, KEYS, ANY);
    return { keys: [...keys], invalid };
};

describe("parseCharacteristics", () => {
    it("picks the listed characteristics, whatever the case and separators", () => {
        expect(parse("WS")).toEqual({ keys: ["WS"], invalid: [] });
        expect(parse(" ws,bs  inf ")).toEqual({ keys: ["WS", "BS", "Inf"], invalid: [] });
    });

    it("picks the characteristics of Any and leaves out the excluded ones", () => {
        expect(parse("Any").keys).toEqual(ANY);
        expect(parse("any -t, -COR").keys).toEqual(ANY.filter(k => k !== "T"));
        expect(parse("WS, BS -BS").keys).toEqual(["WS"]);
    });

    it("adds a characteristic Any leaves out when it is named", () => {
        expect(parse("Any, Inf").keys).toEqual([...ANY, "Inf"]);
        expect(parse("Inf Cor").keys).toEqual(["Inf", "Cor"]);
    });

    it("starts exclusions alone from Any", () => {
        expect(parse("-T").keys).toEqual(ANY.filter(k => k !== "T"));
    });

    it("takes Any as all the keys when no list of it is given", () => {
        expect([...parseCharacteristics("Any", KEYS).keys]).toEqual(KEYS);
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
