import { afterEach, describe, expect, it } from "vitest";
import { loadState } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { characteristicsOf } from "./computed";
import { characterState } from "./state";

afterEach(() => teardownSheet());

describe("characteristicsOf", () => {
    it("parses a name against the characteristics of the loaded sheet, also after another sheet", () => {
        loadState({});
        expect([...characteristicsOf("Any -Cor").keys]).toEqual(["WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Inf"]);

        // A sheet of a kind with other characteristics, as loading one replaces the object.
        (characterState as { characteristics: object }).characteristics = { Ag: {}, Str: {} };
        expect(characteristicsOf("WS").invalid).toEqual(["WS"]);
        expect([...characteristicsOf("Any -Cor").keys]).toEqual([]);
        expect([...characteristicsOf("Any").keys]).toEqual(["Ag", "Str"]);

        loadState({});
        expect(characteristicsOf("WS").invalid).toEqual([]);
    });
});
