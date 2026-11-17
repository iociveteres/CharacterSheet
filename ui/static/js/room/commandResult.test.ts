import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messageText, renderResult, versusOutcome } from "./commandResult";
import type { ResultData } from "./commands.gen";

// Rolls with what the server made of them (TestVersusResultsGolden in
// internal/commands/result_data_test.go).
const golden: { command: string; result: string; data: ResultData }[] =
    JSON.parse(readFileSync("internal/commands/testdata/versus_results.json", "utf8"));

describe("the result of a versus roll", () => {
    it.each(golden.map(c => [c.command, c]))("%s reads in English as the server's text", (_, c) => {
        expect(renderResult(c.data)).toBe(c.result);
    });
});

describe("the initiative of NPCs rolled from an encounter", () => {
    const data: ResultData = {
        kind: "initiative", expression: "", target: 0, rolls: [], initiative: [
            { name: "", group: 1, expression: "1d10+4", total: 9 },
            { name: "Огрин", expression: "1d10", total: 3 },
        ],
    };

    it("reads as the lines the server stores, an unnamed group by its number", () => {
        // internal/roomws/encounter.go: fmt.Sprintf("%s: %s = %d"), joined with "\n".
        const [group, named] = renderResult(data)!.split("\n");
        expect(group).toMatch(/\b1: 1d10\+4 = 9$/);
        expect(named).toBe("Огрин: 1d10 = 3");
    });

    it("is headed the same whatever body was stored, other messages as typed", () => {
        expect(messageText("Initiative", data)).toBe(messageText("Инициатива", data));
        expect(messageText("/r d100", null)).toBe("/r d100");
        expect(messageText("/r d100 vs 40", { kind: "versus", expression: "d100", target: 40, rolls: [{ roll: 3, success: true, degrees: 3 }] }))
            .toBe("/r d100 vs 40");
    });

    it("is no outcome for a sheet", () => {
        expect(versusOutcome(data)).toBeNull();
    });
});

describe("the outcome of a versus roll for the sheet", () => {
    it("is that of its single roll", () => {
        expect(versusOutcome({ kind: "versus", expression: "d100", target: 40, rolls: [{ roll: 33, success: true, degrees: 1, doubles: true }] }))
            .toEqual({ roll: 33, target: 40, success: true, degrees: 1, crit: false, doubles: true });
    });

    it("is none for a repeated roll or a message without data", () => {
        expect(versusOutcome({ kind: "versus", expression: "d100", target: 40, repeat: 1, total: 1, rolls: [{ roll: 33, success: true, degrees: 1 }] }))
            .toBeNull();
        expect(versusOutcome(undefined)).toBeNull();
        expect(versusOutcome(null)).toBeNull();
    });
});
