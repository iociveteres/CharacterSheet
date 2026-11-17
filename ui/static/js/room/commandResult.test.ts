import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messageText, renderResult, versusOutcome } from "./commandResult";
import type { ResultData } from "./commands.gen";
import { installDictionary } from "../i18n/testDictionary";

// Rolls with what the server made of them (TestVersusResultsGolden in
// internal/commands/result_data_test.go).
const golden: { command: string; result: string; data: ResultData }[] =
    JSON.parse(readFileSync("internal/commands/testdata/versus_results.json", "utf8"));

describe("the result of a versus roll", () => {
    it.each(golden.map(c => [c.command, c]))("%s reads in English as the server's text", (_, c) => {
        expect(renderResult(c.data)).toBe(c.result);
    });

    it("reads in Russian with the forms of the number", () => {
        installDictionary("ru");
        const single: ResultData = {
            kind: "versus", expression: "d100+10", target: 70, bonus: 1, rolls: [{ output: "45 + 10", roll: 55, success: true, degrees: 3 }],
        };
        expect(renderResult(single)).toBe("d100+10 vs 70 [+1]:\n45 + 10 = 55\n55, 3 Успеха");

        const repeated: ResultData = {
            kind: "versus", expression: "d100", target: 50, repeat: 3, total: -6, rolls: [
                { roll: 5, success: true, degrees: 5, crit: true },
                { roll: 99, success: false, degrees: 5, crit: true, doubles: true },
                { roll: 100, success: false, degrees: 6, crit: true, doubles: true },
            ],
        };
        expect(renderResult(repeated)).toBe(
            "3x(d100 vs 50):\n5, 5 Успехов, крит!\n99, 5 Провалов, крит!\n100, 6 Провалов, крит!\n5 - 5 - 6 = -6\nИтого: 6 Провалов",
        );
        expect(renderResult({ ...repeated, total: 1, rolls: [{ roll: 21, success: true, degrees: 1 }] }))
            .toBe("3x(d100 vs 50):\n21, 1 Успех\n1 = 1\nИтого: 1 Успех");
    });
});

describe("the initiative of NPCs rolled from an encounter", () => {
    const data: ResultData = {
        kind: "initiative", expression: "", target: 0, rolls: [], initiative: [
            { name: "", group: 1, expression: "1d10+4", total: 9 },
            { name: "Огрин", expression: "1d10", total: 3 },
        ],
    };

    it("reads as the lines the server stores, an unnamed group in the viewer's language", () => {
        // internal/roomws/encounter.go: fmt.Sprintf("%s: %s = %d"), joined with "\n".
        expect(renderResult(data)).toBe("Group 1: 1d10+4 = 9\nОгрин: 1d10 = 3");
        installDictionary("ru");
        expect(renderResult(data)).toBe("Группа 1: 1d10+4 = 9\nОгрин: 1d10 = 3");
    });

    it("is headed Initiative in the viewer's language, whatever body was stored", () => {
        expect(messageText("Initiative", data)).toBe("Initiative");
        installDictionary("ru");
        expect(messageText("Initiative", data)).toBe("Инициатива");
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
