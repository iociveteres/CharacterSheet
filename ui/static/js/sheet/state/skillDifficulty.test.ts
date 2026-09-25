import { beforeEach, describe, expect, it } from "vitest";
import { computed, type Signal } from "@preact/signals-core";
import { loadState } from "../components/testUtils";
import { attachComputeds } from "./computed.js";
import { getRollValue, rollBonusSuccesses } from "./rollBase.js";
import { characterState } from "./state.js";
import { createItemInState, resolvePath } from "./sync.js";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;

type Entry = { name: string; skillBonus: string };
const entries = (...list: Entry[]) => ({
    items: Object.fromEntries(list.map((e, i) => [`e${i}`, { type: "skill_bonus", ...e }])),
    layouts: Object.fromEntries(list.map((_, i) => [`e${i}`, pos(0, i)])),
});

// Advances: none −20, +0 gives 0, +10 gives 10.
const content = () => ({
    characteristics: {
        WS: { value: "35" },
        A: { value: "30", unnatural: "2" },
        I: { value: "45", unnatural: "6" },
        P: { value: "38" },
    },
    skillsLeft: {
        awareness: { characteristic: "P", plus0: true, plus10: true, miscBonus: 5 },
        acrobatics: { characteristic: "A" },
        "tech-use": { characteristic: "I", plus0: true },
    },
    skillsRight: {
        "1_forbidden_lore": { name: "Daemonology", characteristic: "I", plus0: true },
        "2_forbidden_lore": { characteristic: "I" },
    },
    customSkills: {
        list: {
            items: {
                c1: { name: "Void Pilot", characteristic: "A", plus0: true, plus10: true },
                c2: { name: "", characteristic: "WS" },
            },
            layouts: { c1: pos(0, 0), c2: pos(0, 1) },
        },
    },
    conditions: {
        list: {
            items: {
                k1: {
                    name: "Blessed", enabled: true, stacks: 2,
                    entries: entries(
                        { name: "Awareness", skillBonus: "10" },
                        { name: "Daemonology", skillBonus: "4" },
                        // X is the stack count; the name matches tech-use loosely.
                        { name: "tech use", skillBonus: "X" },
                    ),
                },
            },
            layouts: { k1: pos(0, 0) },
        },
    },
    gear: {
        list: {
            items: { g1: { name: "Boots", equipped: true, entries: entries({ name: "Acrobatics", skillBonus: "7" }) } },
            layouts: { g1: pos(0, 0) },
        },
    },
    cybernetics: {
        list: {
            items: { y1: { name: "Plug", entries: entries({ name: "void pilot", skillBonus: "3" }) } },
            layouts: { y1: pos(0, 0) },
        },
    },
});

beforeEach(() => {
    loadState(content());
    attachComputeds(characterState);
});

describe("skill difficulty", () => {
    it("adds advances, the misc bonus and the skill bonuses of conditions, gear and implants", () => {
        expect(value("skillsLeft.awareness.difficulty")).toBe(38 + 10 + 5 + 10);
        expect(value("skillsLeft.acrobatics.difficulty")).toBe(30 - 20 + 7);
        expect(value("skillsLeft.tech-use.difficulty")).toBe(45 + 0 + 2);
        expect(value("customSkills.list.items.c1.difficulty")).toBe(30 + 10 + 3);
    });

    it("takes the bonuses of a right-column row by the name the player gave it, else by its key", () => {
        expect(value("skillsRight.1_forbidden_lore.difficulty")).toBe(45 + 0 + 4);
        expect(value("skillsRight.2_forbidden_lore.difficulty")).toBe(45 - 20);
    });

    it("gives an unnamed custom skill no bonuses", () => {
        expect(value("customSkills.list.items.c2.difficulty")).toBe(35 - 20);
    });
});

describe("roll base", () => {
    it("is the characteristic or the difficulty of the skill it names", () => {
        expect(getRollValue("P")).toBe(38);
        expect(getRollValue("")).toBe(0);
        expect(getRollValue("unknown")).toBe(0);
        expect(getRollValue("awareness")).toBe(value("skillsLeft.awareness.difficulty"));
        expect(getRollValue("Void Pilot")).toBe(value("customSkills.list.items.c1.difficulty"));
    });

    it("tests a skill on another characteristic with the same bonuses as its own difficulty", () => {
        expect(getRollValue("awareness (I)")).toBe(45 + 10 + 5 + 10);
        expect(getRollValue("tech-use (A)")).toBe(30 + 0 + 2);
        expect(getRollValue("void pilot (I)")).toBe(45 + 10 + 3);
    });

    it("updates a roll on a custom skill when the skill is created", () => {
        const total = computed(() => getRollValue("Forbidden Archive"));
        expect(total.value).toBe(0);
        createItemInState("customSkills.list.items", "c3", { name: "Forbidden Archive", characteristic: "I", plus0: true }, pos(0, 2));
        expect(total.value).toBe(45);
    });

    it("gets bonus successes from the characteristic the roll is tested on", () => {
        expect(rollBonusSuccesses("I")).toBe(3);
        expect(rollBonusSuccesses("acrobatics")).toBe(1);
        expect(rollBonusSuccesses("awareness")).toBe(0);
        expect(rollBonusSuccesses("awareness (I)")).toBe(3);
        expect(rollBonusSuccesses("Void Pilot")).toBe(1);
        expect(rollBonusSuccesses("")).toBe(0);
    });
});
