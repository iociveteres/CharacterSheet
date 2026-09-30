import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet, testState } from "../components/testUtils";
import { characteristicsOf } from "./computed";

afterEach(() => teardownSheet());

describe("characteristicsOf", () => {
    it("parses a name against the characteristics of the loaded sheet, also after another sheet", () => {
        loadState({});
        // Any leaves out Inf and Cor.
        expect([...characteristicsOf(testState(), "Any -T").keys]).toEqual(["WS", "BS", "S", "A", "I", "P", "W", "F"]);

        // A sheet of a kind with other characteristics, as loading one replaces the object.
        (testState() as { characteristics: object }).characteristics = { Ag: {}, Str: {} };
        expect(characteristicsOf(testState(), "WS").invalid).toEqual(["WS"]);
        expect([...characteristicsOf(testState(), "Any -Cor").keys]).toEqual([]);
        expect([...characteristicsOf(testState(), "Any").keys]).toEqual(["Ag", "Str"]);

        loadState({});
        expect(characteristicsOf(testState(), "WS").invalid).toEqual([]);
    });

    it("keeps parsing right once many names were typed", () => {
        loadState({});
        const ws = characteristicsOf(testState(), "WS, BS");
        for (let i = 0; i < 1000; i++) characteristicsOf(testState(), `WS${i}`);
        expect(characteristicsOf(testState(), "WS, BS")).not.toBe(ws);
        expect([...characteristicsOf(testState(), "WS, BS").keys]).toEqual(["WS", "BS"]);
    });
});
