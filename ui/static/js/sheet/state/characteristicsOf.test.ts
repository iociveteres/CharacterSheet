import { afterEach, describe, expect, it } from "vitest";
import { loadState } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { characteristicsOf } from "./computed";
import { characterState } from "./state";

afterEach(() => teardownSheet());

describe("characteristicsOf", () => {
    it("parses a name against the characteristics of the loaded sheet, also after another sheet", () => {
        loadState({});
        // Any leaves out Inf and Cor.
        expect([...characteristicsOf("Any -T").keys]).toEqual(["WS", "BS", "S", "A", "I", "P", "W", "F"]);

        // A sheet of a kind with other characteristics, as loading one replaces the object.
        (characterState as { characteristics: object }).characteristics = { Ag: {}, Str: {} };
        expect(characteristicsOf("WS").invalid).toEqual(["WS"]);
        expect([...characteristicsOf("Any -Cor").keys]).toEqual([]);
        expect([...characteristicsOf("Any").keys]).toEqual(["Ag", "Str"]);

        loadState({});
        expect(characteristicsOf("WS").invalid).toEqual([]);
    });

    it("keeps parsing right once many names were typed", () => {
        loadState({});
        const ws = characteristicsOf("WS, BS");
        for (let i = 0; i < 1000; i++) characteristicsOf(`WS${i}`);
        expect(characteristicsOf("WS, BS")).not.toBe(ws);
        expect([...characteristicsOf("WS, BS").keys]).toEqual(["WS", "BS"]);
    });
});
