import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet, testState } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { spellRollFromTest } from "./spellRoll";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

/** A sheet of `kind` with the Magic test `options` in their order, and a bard's Deceive +10. */
function load(kind: typeof pathfinderCrusade, options: Record<string, object>, over: object = {}) {
    loadState({
        spellcasting: { arcane: true },
        skillsLeft: { deceive: { plus0: true, plus10: true } },
        psykana: {
            testOptions: { items: options, layouts: Object.fromEntries(Object.keys(options).map((id, i) => [id, pos(0, i)])) },
        },
        ...over,
    }, kind);
    attachComputeds(testState());
}

const WIZARD = { cast: { base: "cast" }, w: { base: "W" }, spellcraft: { base: "spellcraft" } };
const roll = (test: string, arts = false) => spellRollFromTest(testState(), test, arts);

afterEach(teardownSheet);

describe("spellRollFromTest of a PR spell", () => {
    it("tests a wizard's Terrify on W and Fireball on Cast, by the options of the sheet", () => {
        load(pathfinderCrusade, WIZARD);
        expect(roll("W–20 vs W+0")).toEqual({ roll: { testOption: "w", modifier: -20 } });
        expect(roll("Cs+0 vs T+0")).toEqual({ roll: { testOption: "cast", modifier: 0 } });
        expect(roll("Cs–10 vss T–10")).toEqual({ roll: { testOption: "cast", modifier: -10 } });
    });

    it("gives 0 for a modifier that is not one number, and the first alternative of «/»", () => {
        load(pathfinderCrusade, WIZARD);
        expect(roll("Cs+20/10/0 (vss S+0)")).toEqual({ roll: { testOption: "cast", modifier: 0 } });
        expect(roll("Cs–20×Редкость")).toEqual({ roll: { testOption: "cast", modifier: 0 } });
        expect(roll("Cs+0/Cs–50")).toEqual({ roll: { testOption: "cast", modifier: 0 } });
    });

    it("adds the option the sheet has not, as a player deleted W", () => {
        load(pathfinderCrusade, { cast: { base: "cast" } });
        const { roll: r, option } = roll("W–20 vs W+0");
        expect(option).toEqual({ id: expect.stringMatching(/^test-option-/), base: "W", characteristic: "" });
        expect(r).toEqual({ testOption: option!.id, modifier: -20 });

        load(pathfinderCrusade, { w: { base: "W" } });
        expect(roll("Cs+10").option).toMatchObject({ base: "cast", characteristic: "" });
    });

    it("finds a skill by its characteristic, its own as none", () => {
        load(pathfinderCrusade, { ...WIZARD, spellcraftI: { base: "spellcraft", characteristic: "I" } });
        expect(roll("Spellcraft(P) +10")).toEqual({ roll: { testOption: "spellcraft", modifier: 10 } });
        expect(roll("Spellcraft(I) +10")).toEqual({ roll: { testOption: "spellcraftI", modifier: 10 } });
        expect(roll("Spellcraft(F) +0").option).toMatchObject({ base: "spellcraft", characteristic: "F" });
        expect(roll("Logic+10").option).toMatchObject({ base: "logic", characteristic: "" });
    });

    it("keeps the first option for what the sheet cannot have, and the default roll for a test it cannot read", () => {
        load(pathfinderCrusade, WIZARD);
        expect(roll("Cor+0")).toEqual({ roll: { modifier: 0 } });
        expect(roll("Psyniscience(P)–10")).toEqual({ roll: { modifier: -10 } });
        expect(roll("")).toEqual({ roll: {} });
        expect(roll("see the description")).toEqual({ roll: {} });
    });

    it("reads the tests of Black Crusade, which has no Cast", () => {
        load(blackCrusade, { w: { base: "W" }, psy: { base: "psyniscience" } });
        expect(roll("W+40")).toEqual({ roll: { testOption: "w", modifier: 40 } });
        expect(roll("Psyniscience (P)–10")).toEqual({ roll: { testOption: "psy", modifier: -10 } });
        expect(roll("Cor+0").option).toMatchObject({ base: "Cor", characteristic: "" });
        expect(roll("Cs+0")).toEqual({ roll: { modifier: 0 } });
    });
});

describe("spellRollFromTest of an Arts spell", () => {
    it("tests Delude (Bard) on the skill its test names, as its button sets it", () => {
        load(pathfinderCrusade, WIZARD);
        expect(roll("Deceive(F) -10 vs W +0", true)).toEqual({ roll: { skill: "deceive", characteristic: "F", modifier: -10 } });
        expect(roll("Trade(Musician, Orator)(F) +20/-20 vs W +0", true)).toEqual({ roll: {} });
        expect(roll("Cs+0", true)).toEqual({ roll: {} });
    });
});
