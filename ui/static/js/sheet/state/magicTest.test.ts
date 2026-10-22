import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet, testState } from "../components/testUtils";
import { PATHFINDER_CRUSADE_STATS, pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { BLACK_CRUSADE_STATS } from "../schema/constants";
import { attachComputeds } from "./computed";
import { magicTestChoices, parseMagicTest } from "./magicTest";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const S1 = "psykana.tabs.items.t1.powers.items.s1";
const BARDIC = ["Dancer", "Musician", "Orator", "Soothsayer"];

const parse = (text: string) => parseMagicTest(text, PATHFINDER_CRUSADE_STATS);
const alt = (skill: string, characteristics: string[], modifier: number | null = 0, specText = "", specs: string[] = []) =>
    ({ skill, specs, specText, characteristics, modifier });

describe("parseMagicTest", () => {
    it("reads a skill, the characteristics it may be tested on and its modifier, without the opposed test", () => {
        expect(parse("Deceive(F) +0 vs W +0")).toEqual([alt("Deceive", ["F"])]);
        expect(parse("Intimidate(F или W) -10 vs W +0")).toEqual([alt("Intimidate", ["F", "W"], -10)]);
        expect(parse("Awareness (F или P) +0")).toEqual([alt("Awareness", ["F", "P"])]);
        expect(parse("Parry(F или Ws) − 10")).toEqual([alt("Parry", ["F", "WS"], -10)]);
        expect(parse("Acrobatics(A)+20")).toEqual([alt("Acrobatics", ["A"], 20)]);
        expect(parse("Charm(F)")).toEqual([alt("Charm", ["F"])]);
    });

    it("gives no modifier for one that is not a single number", () => {
        expect(parse("Charm(F) +20/-20")).toEqual([alt("Charm", ["F"], null)]);
    });

    it("reads the alternatives of «или», but not those inside the parentheses", () => {
        expect(parse("Athletics(S)-10 или Acrobatics(A)+0")).toEqual([alt("Athletics", ["S"], -10), alt("Acrobatics", ["A"])]);
        expect(parse("Trade(Armoursmith, Weaponsmith или Engineer)(I) +10"))
            .toEqual([alt("Trade", ["I"], 10, "Armoursmith, Weaponsmith или Engineer", ["Armoursmith", "Weaponsmith", "Engineer"])]);
        expect(parse("Trade(Musician, Orator)(F) +20/-20 vs W +0")).toEqual([alt("Trade", ["F"], null, "Musician, Orator", ["Musician", "Orator"])]);
    });

    it("expands a family of the kind, Trade(Bardic), tested on the skill's own characteristic", () => {
        expect(parse("Trade(Bardic)(Стат Навыка) -10")).toEqual([alt("Trade", [""], -10, "Bardic", BARDIC)]);
        expect(parse("Charm(F) +0 или Trade(Bardic)(Стат Навыка) +0 vs W +0")).toEqual([alt("Charm", ["F"]), alt("Trade", [""], 0, "Bardic", BARDIC)]);
    });

    it("reads nothing of free text or an empty test", () => {
        expect(parse("")).toEqual([]);
        expect(parse("see the description")).toEqual([]);
        expect(parse("Logic")).toEqual([]);
    });
});

describe("parseMagicTest of a spell cast by PR", () => {
    const stat = (characteristic: string, modifier: number | null = 0) => alt("", [characteristic], modifier);

    it("reads a characteristic alone, Cs, written Cast too, for the cast's own", () => {
        expect(parse("Cs+20")).toEqual([stat("Cs", 20)]);
        expect(parse("Cs–30 vs W+0")).toEqual([stat("Cs", -30)]);
        expect(parse("Cast+10")).toEqual([stat("Cs", 10)]);
        expect(parse("W–20 vs W+0")).toEqual([stat("W", -20)]);
        expect(parse("W-20 vs W+0")).toEqual([stat("W", -20)]);
        expect(parse("P+0")).toEqual([stat("P")]);
        expect(parse("Cs+0 vs W+5×бPR")).toEqual([stat("Cs")]);
        expect(parse("Cs+10 vs T+0 (только для несогласной цели)")).toEqual([stat("Cs", 10)]);
    });

    it("reads Cor and Inf of the book on a kind without them", () => {
        expect(parse("Cor+0")).toEqual([stat("Cor")]);
        expect(parseMagicTest("Cor–20", BLACK_CRUSADE_STATS)).toEqual([stat("Cor", -20)]);
    });

    it("reads a skill without its characteristic by its modifier", () => {
        expect(parse("Logic+10")).toEqual([alt("Logic", [], 10)]);
        expect(parse("Logic–60")).toEqual([alt("Logic", [], -60)]);
        expect(parse("Scholastic Lore (Beasts) -10")).toEqual([alt("Scholastic Lore", [], -10, "Beasts", ["Beasts"])]);
        expect(parseMagicTest("Psyniscience(P)–40 vs Inf+0", BLACK_CRUSADE_STATS)).toEqual([alt("Psyniscience", ["P"], -40)]);
        expect(parse("Common Lore (Religion)(W) +10")).toEqual([alt("Common Lore", ["W"], 10, "Religion", ["Religion"])]);
    });

    it("reads the tests of «/» as alternatives, the modes of a modifier as no number", () => {
        expect(parse("Cs+0/Cs–50")).toEqual([stat("Cs"), stat("Cs", -50)]);
        expect(parse("Cs+20 / –40 vs W+0")).toEqual([stat("Cs", null)]);
        expect(parse("W+20/10/0 (vss S+0)")).toEqual([stat("W", null)]);
    });

    it("reads vss as vs, and the target's test in parentheses", () => {
        expect(parse("Cs–10 vss T–10")).toEqual([stat("Cs", -10)]);
        expect(parse("Cs+20/10/0 (vss S+0)")).toEqual([stat("Cs", null)]);
        expect(parse("Cs–10 (vs S/Athletics+0)")).toEqual([stat("Cs", -10)]);
    });

    it("gives no modifier for one multiplied", () => {
        expect(parse("Cs–20×Редкость")).toEqual([stat("Cs", null)]);
        expect(parse("Cs–10×(PR развеиваемого эффекта)")).toEqual([stat("Cs", null)]);
        expect(parse("W–10×PR")).toEqual([stat("W", null)]);
    });
});

describe("magicTestChoices", () => {
    afterEach(teardownSheet);

    /** A bard with Charm +0, Musician +10 and Orator +0 in the Trade rows, Cook beside them, and a spell tested on `test`. */
    function load(test: string, over: object = {}) {
        loadState({
            skillsLeft: { charm: { plus0: true } },
            skillsRight: {
                "1_trade": { name: "Musician", plus0: true, plus10: true },
                "2_trade": { name: "Trade (Orator)", plus0: true },
                "3_trade": { name: "Cook", plus0: true },
            },
            psykana: { tabs: { items: { t1: { name: "Bard", powers: { items: { s1: { name: "Spell", psychotest: test } }, layouts: { s1: pos(0, 0) } } } }, layouts: { t1: pos(0, 0) } } },
            ...over,
        }, pathfinderCrusade);
        attachComputeds(testState());
        return magicTestChoices(testState(), S1);
    }

    it("offers each skill of the sheet an alternative names, by the characteristics it allows", () => {
        expect(load("Charm(F) -10 или Trade(Bardic)(Стат Навыка) +0 vs W +0")).toEqual({
            choices: [
                { skill: "charm", characteristic: "F", label: "Charm (F)", level: 1, modifier: -10 },
                { skill: "1_trade", characteristic: "", label: "Musician", level: 2, modifier: 0 },
                { skill: "2_trade", characteristic: "", label: "Trade (Orator)", level: 1, modifier: 0 },
            ],
            missing: [],
        });
        expect(load("Stealth(F или A) +0").choices).toEqual([
            { skill: "stealth", characteristic: "F", label: "Stealth (F)", level: 0, modifier: 0 },
            { skill: "stealth", characteristic: "A", label: "Stealth (A)", level: 0, modifier: 0 },
        ]);
    });

    it("finds a grouped row by its group and a custom skill by its name", () => {
        expect(load("Navigation(Surface)(I) +0").choices).toEqual([{ skill: "navigation_surface", characteristic: "I", label: "Navigation: Surface (I)", level: 0, modifier: 0 }]);
        const custom = { customSkills: { list: { items: { c1: { name: "Trade (Dancer)", characteristic: "A" } }, layouts: { c1: pos(0, 0) } } } };
        expect(load("Trade(Bardic)(Стат Навыка) +0", custom).choices.map(c => c.skill)).toEqual(["1_trade", "2_trade", "custom:c1"]);
    });

    it("names what the sheet has no skill for", () => {
        expect(load("Trade(Bardic)(Стат Навыка) +0", { skillsRight: {} })).toEqual({
            choices: [], missing: ["Trade (Bardic): Dancer, Musician, Orator or Soothsayer"],
        });
        expect(load("Trade(Armoursmith или Weaponsmith)(I) +10").missing).toEqual(["Trade (Armoursmith или Weaponsmith): Armoursmith or Weaponsmith"]);
        expect(load("Trade(Cook)(I) +0")).toMatchObject({ choices: [{ skill: "3_trade", characteristic: "I" }], missing: [] });
    });

    it("offers no skill for a test on a characteristic alone", () => {
        expect(load("Cs+0 или Charm(F) +0")).toEqual({ choices: [{ skill: "charm", characteristic: "F", label: "Charm (F)", level: 1, modifier: 0 }], missing: [] });
        expect(load("W–20 vs W+0")).toEqual({ choices: [], missing: [] });
    });
});
