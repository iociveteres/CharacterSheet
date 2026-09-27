import { beforeEach, describe, expect, it } from "vitest";
import {
    presetRollCommand, readDiceSettings, rollExactCommand, rollVersusCommand, saveDiceSettings, standardRollCommand,
    type DiceSettings,
} from "./dice";

const settings = (change: Partial<DiceSettings> = {}): DiceSettings =>
    ({ amount: 1, modifier: 0, rollAgainst: ["", "", "", ""], selected: null, ...change });

describe("a roll from the sheet", () => {
    it("tests against the target, with bonus successes only when there are any", () => {
        expect(rollVersusCommand(40, 0, "")).toBe("/r d100 vs 40");
        expect(rollVersusCommand(40, 2, "")).toBe("/r d100 vs 40 [+2]");
        expect(rollExactCommand("2d10+3", "")).toBe("/r 2d10+3");
    });

    it("puts each line of the label under the command as a >> line", () => {
        expect(rollVersusCommand(40, 1, "Awareness")).toBe("/r d100 vs 40 [+1]\n>> Awareness");
        expect(rollExactCommand("d100", ">> Bolter\r\n\n  >>Tearing  \n")).toBe("/r d100\n>> Bolter\n>> Tearing");
        expect(rollExactCommand("d10", "   ")).toBe("/r d10");
    });

    it("cuts a label longer than 200 characters", () => {
        expect(rollExactCommand("d10", "a".repeat(201))).toBe(`/r d10\n>> ${"a".repeat(200)}…`);
        expect(rollExactCommand("d10", "a".repeat(200))).toBe(`/r d10\n>> ${"a".repeat(200)}`);
    });
});

describe("a roll of the dice buttons", () => {
    it("adds the modifier to the dice", () => {
        expect(standardRollCommand(10, settings({ amount: 3 }))).toBe("/r 3d10");
        expect(standardRollCommand(10, settings({ modifier: 20 }))).toBe("/r 1d10+20");
        expect(standardRollCommand(100, settings({ modifier: -30 }))).toBe("/r 1d100-30");
    });

    it("against the checked target moves the target by the modifier", () => {
        const against = settings({ rollAgainst: ["", " 45 ", "", ""], selected: 1, modifier: -20 });

        expect(standardRollCommand(100, against)).toBe("/r 1d100 vs 25");
    });

    it("ignores a checked target that is not a number from 1", () => {
        for (const target of ["", "0", "abc"]) {
            expect(standardRollCommand(100, settings({ rollAgainst: [target, "", "", ""], selected: 0, modifier: 10 })))
                .toBe("/r 1d100+10");
        }
    });
});

describe("a preset", () => {
    it("is rolled with or without /r written, and not when empty", () => {
        expect(presetRollCommand(" 2d10+5 ")).toBe("/r 2d10+5");
        expect(presetRollCommand("/r d100 vs 40")).toBe("/r d100 vs 40");
        expect(presetRollCommand("  ")).toBeNull();
    });
});

describe("the dice settings", () => {
    beforeEach(() => localStorage.clear());

    it("are read from the keys the Alpine room saved them under", () => {
        localStorage.setItem("dice_amount_room_5", "3");
        localStorage.setItem("dice_modifier_room_5", "-20");
        localStorage.setItem("dice_roll_against_1_room_5", "45");
        localStorage.setItem("dice_roll_against_selected_room_5", "1");

        expect(readDiceSettings(5)).toEqual({ amount: 3, modifier: -20, rollAgainst: ["", "45", "", ""], selected: 1 });
        expect(readDiceSettings(6)).toEqual(settings());
    });

    it("out of their range are left at the defaults", () => {
        localStorage.setItem("dice_amount_room_5", "6");
        localStorage.setItem("dice_modifier_room_5", "70");
        localStorage.setItem("dice_roll_against_selected_room_5", "4");

        expect(readDiceSettings(5)).toEqual(settings());
    });

    it("are saved without empty targets and without an unchecked selection", () => {
        saveDiceSettings(5, settings({ amount: 2, rollAgainst: [" 30 ", "", "", ""], selected: 0 }));
        saveDiceSettings(5, settings({ amount: 2, rollAgainst: ["", "", "", "50"] }));

        expect(localStorage.getItem("dice_amount_room_5")).toBe("2");
        expect(localStorage.getItem("dice_roll_against_0_room_5")).toBeNull();
        expect(localStorage.getItem("dice_roll_against_3_room_5")).toBe("50");
        expect(localStorage.getItem("dice_roll_against_selected_room_5")).toBeNull();
        expect(readDiceSettings(5)).toEqual(settings({ amount: 2, rollAgainst: ["", "", "", "50"] }));
    });
});
