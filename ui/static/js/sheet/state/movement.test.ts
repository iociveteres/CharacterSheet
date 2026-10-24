import { beforeEach, describe, expect, it } from "vitest";
import { conditionOf, loadState, testState } from "../components/testUtils";
import { parseDamage, WEAPON_REFS } from "../damage";
import { movementSummary } from "./characteristicSummary";
import { attachComputeds } from "./computed";
import { MOVE_COLUMNS, modeDistance, spdProblem } from "./movement";
import { createItemInState, updateSignalAtPath, valueAt } from "./sync";

const [HALF, FULL, , RUN] = MOVE_COLUMNS;
const MOVE = "movement.modes.items.m1";
const FLIGHT = "movement.modes.items.m2";

const mode = (name: string, spd: string, mults: object = {}) => ({ name, spd, halfMult: 1, fullMult: 2, chargeMult: 3, runMult: 6, ...mults });

const content = (extra: object = {}) => ({
    characteristics: { A: { value: "35" }, S: { value: "41" } },
    size: 1,
    movement: {
        modes: {
            items: { m1: mode("Move", "A.b+Size+1"), m2: mode("Flight", "6", { runMult: 0 }) },
            layouts: { m1: { colIndex: 0, rowIndex: 0 }, m2: { colIndex: 0, rowIndex: 1 } },
        },
    },
    ...extra,
});

const distances = (path: string) => MOVE_COLUMNS.map(c => valueAt(testState(), `${path}.${c.key}`));

beforeEach(() => {
    loadState(content());
    attachComputeds(testState());
});

describe("movement modes", () => {
    it("count each mode's SPD from its expression times its multipliers", () => {
        // A.b 3 + Size 1 + 1; Flight 6 ignores size, its Run 0 is the rules' 6.
        expect(distances(MOVE)).toEqual(["5", "10", "15", "30"]);
        expect(distances(FLIGHT)).toEqual(["6", "12", "18", "36"]);
    });

    it("follow the characteristic, the size and the multipliers", () => {
        updateSignalAtPath(testState(), "characteristics.A.value", "52");
        updateSignalAtPath(testState(), "size", "-2");
        updateSignalAtPath(testState(), `${MOVE}.fullMult`, 1.5);
        expect(distances(MOVE)).toEqual(["4", "6", "12", "24"]);
    });

    it("add the conditions' movement bonus to every mode", () => {
        loadState(content({ conditions: conditionOf({ type: "movement_bonus", movementBonus: "2" }) }));
        attachComputeds(testState());
        expect(valueAt(testState(), `${MOVE}.half`)).toBe("7");
        expect(valueAt(testState(), `${FLIGHT}.half`)).toBe("8");
    });

    it("count SPD of 0 or less as 0.5", () => {
        updateSignalAtPath(testState(), `${MOVE}.spd`, "A.b-5");
        expect(distances(MOVE)).toEqual(["0.5", "1", "1.5", "3"]);
    });

    it("show no distance while the SPD reads as no number", () => {
        for (const spd of ["", "A.b+Fly", "1d10"]) {
            updateSignalAtPath(testState(), `${MOVE}.spd`, spd);
            expect(modeDistance(testState(), MOVE, HALF)).toBe("—");
        }
        expect(spdProblem(testState(), "")).toBe("No SPD");
        expect(spdProblem(testState(), "A.b+Fly")).toBe("Unknown: Fly");
        expect(spdProblem(testState(), "2d5")).toBe("SPD takes no dice");
        expect(spdProblem(testState(), "½S.b▲")).toBeNull();
    });

    it("give a new mode its distances", () => {
        createItemInState(testState(), "movement.modes.items", "m3", mode("Swim", "½S.b"), { colIndex: 0, rowIndex: 2 });
        expect(distances("movement.modes.items.m3")).toEqual(["2", "4", "6", "12"]);
    });
});

describe("Size in expressions", () => {
    it("is a reference of a mode's SPD, not of a weapon's damage", () => {
        expect(parseDamage("½Size▲+size", ["A"], ["Size"]).terms).toEqual([
            { kind: "ref", ref: "Size", factor: 0.5, roundUp: true, sign: 1 },
            { kind: "ref", ref: "Size", factor: 1, roundUp: false, sign: 1 },
        ]);
        expect(parseDamage("Size", ["A"], WEAPON_REFS).invalid).toEqual(["Size"]);
    });
});

describe("movementSummary", () => {
    it("names the SPD times the multiplier, its terms and the conditions", () => {
        loadState(content({ conditions: conditionOf({ type: "movement_bonus", movementBonus: "2" }) }));
        attachComputeds(testState());
        expect(movementSummary(testState(), MOVE, HALF)).toEqual(["Move: Half 7", "A.b +3", "Size +1", "+1", "Test +2"]);
        expect(movementSummary(testState(), MOVE, RUN)).toEqual(["Move: Run 42", "SPD 7 × 6", "A.b +3", "Size +1", "+1", "Test +2"]);
    });

    it("leaves out the terms of a lone number", () => {
        expect(movementSummary(testState(), FLIGHT, HALF)).toEqual(["Flight: Half 6"]);
        expect(movementSummary(testState(), FLIGHT, FULL)).toEqual(["Flight: Full 12", "SPD 6 × 2"]);
    });

    it("says when SPD counts as 0.5", () => {
        updateSignalAtPath(testState(), `${MOVE}.spd`, "A.b - 2×Size - 4");
        expect(movementSummary(testState(), MOVE, HALF)).toEqual(["Move: Half 0.5", "A.b +3", "2×Size -2", "-4", "SPD -3 counts as 0.5"]);
    });

    it("says why there is no distance", () => {
        updateSignalAtPath(testState(), `${MOVE}.spd`, "A.b+Fly");
        updateSignalAtPath(testState(), `${MOVE}.name`, "");
        expect(movementSummary(testState(), MOVE, HALF)).toEqual(["Mode: Half —", "Unknown: Fly. Set the SPD under ⚙"]);
    });
});
