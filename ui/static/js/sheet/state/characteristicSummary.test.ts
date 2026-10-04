import { beforeEach, describe, expect, it } from "vitest";
import { loadState, testState } from "../components/testUtils";
import { characteristicSummary, skillSummary, unnaturalSummary } from "./characteristicSummary";
import { attachComputeds } from "./computed";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

const conditionOf = (name: string, stacks: number, entries: object[]) => ({
    name, enabled: true, stacks,
    entries: {
        items: Object.fromEntries(entries.map((e, i) => [`e${i}`, e])),
        layouts: Object.fromEntries(entries.map((_, i) => [`e${i}`, pos(0, i)])),
    },
});

const content = () => ({
    characteristics: { WS: { value: "35", unnatural: "2" }, BS: { value: "40" }, A: { value: "95" } },
    skillsLeft: { dodge: { characteristic: "A", plus0: true, plus10: true, miscBonus: 5 }, awareness: { characteristic: "BS" } },
    fatigue: { fatigueCur: 1, fatigueMode: "physical" },
    conditions: {
        list: {
            items: {
                c1: conditionOf("Rage", 2, [
                    { type: "char_bonus", name: "WS", bonus: "5X", unnaturalBonus: "1" },
                    { type: "roll_bonus", name: "Any", rollBonus: "10", domainMode: "only", domains: { melee: true } },
                    { type: "roll_bonus", name: "WS", rollBonus: "-5", domainMode: "except", domains: { ranged: true, psychic: true } },
                ]),
                c2: conditionOf("Possessed", 1, [
                    { type: "char_override", name: "WS", overrideValue: "50", overrideUnnatural: "" },
                    { type: "char_cap", name: "WS", cap: "55" },
                    { type: "skill_bonus", name: "Dodge", skillBonus: "20" },
                ]),
                // Off: counts nowhere.
                c3: { ...conditionOf("Stunned", 1, [{ type: "char_bonus", name: "WS", bonus: "-30" }]), enabled: false },
            },
            layouts: { c1: pos(0, 0), c2: pos(0, 1), c3: pos(0, 2) },
        },
    },
});

beforeEach(() => {
    loadState(content());
    attachComputeds(testState());
});

describe("characteristicSummary", () => {
    it("names the override, the bonuses and caps, then what the tests add, by their conditions", () => {
        // Override 50 + 10 of Rage ×2, at most 55; tests -10 fatigue -5 Rage; the bonus "only" melee is no ordinary test.
        expect(characteristicSummary(testState(), "WS")).toEqual([
            "WS 55",
            "Possessed sets 50",
            "Rage +10",
            "Possessed: at most 55",
            "Tests at 40:",
            "Fatigue -10",
            "Rage +10, only on Melee",
            "Rage -5, not on Ranged, Psy",
        ]);
    });

    it("shows the permanent value alone when nothing changes it", () => {
        // BS takes the fatigue (physical) and the Any roll bonus of melee only.
        expect(characteristicSummary(testState(), "BS")).toEqual(["BS 40", "Permanent 40", "Tests at 30:", "Fatigue -10", "Rage +10, only on Melee"]);
    });

    it("counts the unnatural without a blank override", () => {
        expect(unnaturalSummary(testState(), "WS")).toEqual(["Unnatural WS 3: +1 success on a passed test", "Permanent 2", "Rage +1"]);
    });
});

describe("skillSummary", () => {
    it("counts the advances, misc and skill bonuses on the characteristic of its tests", () => {
        // A 95 - fatigue 10 = 85; +10 +5 +20. A skill test is no melee roll: the bonus of Rage leaves it out.
        expect(skillSummary(testState(), "skillsLeft.dodge"))
            .toEqual(["Difficulty 120", "A 95", "Fatigue -10", "Advances +10", "Misc +5", "Possessed +20"]);
        // The bonus "except" some rolls counts in a skill test.
        loadState({ ...content(), skillsLeft: { parry: { characteristic: "WS", plus0: true } } });
        attachComputeds(testState());
        expect(skillSummary(testState(), "skillsLeft.parry")).toEqual(["Difficulty 40", "WS 55", "Fatigue -10", "Rage -5, not on Ranged, Psy", "Advances +0"]);
    });

    it("tells an untrained skill and a characteristic over 100", () => {
        loadState({ ...content(), characteristics: { BS: { value: "110" } }, fatigue: {} });
        attachComputeds(testState());
        expect(skillSummary(testState(), "skillsLeft.awareness")).toEqual(["Difficulty 80", "BS 110", "Counts 100 of 110", "Untrained -20"]);
    });
});
