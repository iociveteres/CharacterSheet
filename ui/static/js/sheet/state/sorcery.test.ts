import { afterEach, describe, expect, it } from "vitest";
import { loadState, recordingActions, teardownSheet, testState } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { canRestoreMana, manaShortage, manaUpkeep, payMana, payUpkeep, restoreMana } from "./mana";
import { preparedCount } from "./prepared";
import { castCap, hasSorcery, isSorcery, phenomena, sustainedPowers, sustaining } from "./psychic";
import { focusPools, hasSorcerySpellOf, sorceryCap, sorceryCost, sorceryPool, sorceryTest, sorceryTotal, sorcerySustained } from "./sorcery";
import { resolvePath, updateSignalAtPath, valueAt } from "./sync";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const POWERS = "psykana.tabs.items.t1.powers.items";

/** A sheet of `spells`, by id, in one tab, with `psykana` the other fields of the block. */
const content = (spells: Record<string, object>, over: object = {}, psykana: object = {}) => ({
    characteristics: { F: { value: "40" }, W: { value: "30" } },
    psykana: {
        ...psykana,
        tabs: {
            items: { t1: { name: "Tab", powers: { items: spells, layouts: Object.fromEntries(Object.keys(spells).map((id, i) => [id, pos(0, i)])) } } },
            layouts: { t1: pos(0, 0) },
        },
    },
    ...over,
});

function load(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
}

afterEach(teardownSheet);

const keys = (path: string) => Object.keys(resolvePath(testState(), path) as object);

describe("the data of a Sorcery spell", () => {
    const delude = { name: "Delude", subtypes: "Sorcery (Bard)", level: 1, roll: { skill: "deceive", characteristic: "W", modifier: -10 } };

    it("is a level, a skill and a characteristic of its roll, and a pool of its own on a Pathfinder Crusade sheet", () => {
        load(content({ s1: delude }, { focus: { bard: { current: 2, max: { base: "F.b" } } } }));
        expect(valueAt(testState(), `${POWERS}.s1.level`)).toBe(1);
        expect(valueAt(testState(), `${POWERS}.s1.roll.skill`)).toBe("deceive");
        expect(valueAt(testState(), `${POWERS}.s1.roll.characteristic`)).toBe("W");
        // The fields of the shared roll stay.
        expect(valueAt(testState(), `${POWERS}.s1.roll.modifier`)).toBe(-10);
        expect(valueAt(testState(), "focus.bard.current")).toBe(2);
        expect(valueAt(testState(), "focus.bard.max.base")).toBe("F.b");

        load(content({ s1: { name: "Shield" } }));
        expect([valueAt(testState(), `${POWERS}.s1.level`), valueAt(testState(), "focus.bard.current")]).toEqual([0, 0]);
    });

    it("is none of a Black Crusade sheet", () => {
        load(content({ s1: delude }, { focus: { bard: { current: 2 } } }), blackCrusade);
        expect(keys(`${POWERS}.s1`)).not.toContain("level");
        expect(keys(`${POWERS}.s1.roll`)).not.toContain("skill");
        expect(keys(`${POWERS}.s1.roll`)).not.toContain("characteristic");
        expect("focus" in testState()).toBe(false);
    });
});

describe("the way of a spell", () => {
    const spells = { s1: { name: "Delude", subtypes: "Иллюзия, Sorcery (Bard)" }, s2: { name: "Shield", subtypes: "Колдовство" }, s3: { name: "Jump", subtypes: "Колдовство (Следопыт)" } };

    it("is Sorcery when its Subtypes name the type with a class, on a Pathfinder Crusade sheet", () => {
        load(content(spells));
        expect(hasSorcery(testState())).toBe(true);
        expect(["s1", "s2", "s3"].map(id => isSorcery(testState(), `${POWERS}.${id}`))).toEqual([true, false, true]);
    });

    it("is never Sorcery on a Black Crusade sheet, whatever the Subtypes say", () => {
        load(content(spells), blackCrusade);
        expect(hasSorcery(testState())).toBe(false);
        expect(["s1", "s2", "s3"].map(id => isSorcery(testState(), `${POWERS}.${id}`))).toEqual([false, false, false]);
    });
});

describe("the counting of a sheet with both ways", () => {
    const upkeep = (x: number) => ({ subtypes: `Поддержание (${x})`, sustained: "Free action" });
    /** A Bound caster of base PR 3 with a PR spell and two Sorcery spells sustained, and one of each prepared. */
    const spells = {
        s1: { name: "Bolt", ...upkeep(1), sustain: { copies: 1, pr: 2 } },
        s2: { name: "Delude", ...upkeep(2), subtypes: "Sorcery (Bard), Поддержание (2)", sustain: { copies: 1 } },
        s3: { name: "Blur", subtypes: "Sorcery (Bard)", sustained: "Free action", sustain: { copies: 1 } },
        s4: { name: "Shield", prepared: true },
        s5: { name: "Jump", subtypes: "Sorcery (Ranger)", prepared: true },
    };
    const at = (id: string) => `${POWERS}.${id}`;

    function loadMixed(over: object = {}, kind = pathfinderCrusade) {
        load(content(spells, {
            mana: { current: 2, max: { base: "5" } },
            focus: { bard: { current: 1, max: { base: "F.b" } } },
            ...over,
        }, { psykanaType: "Bound", basePR: 3 }), kind);
    }

    it("takes PR for the PR spells only", () => {
        loadMixed();
        expect(sustainedPowers(testState()).powers.map(p => p.name)).toEqual(["Bolt"]);
        expect(sustaining(testState()).taken).toBe(1);
        expect(valueAt(testState(), "psykana.effectivePR")).toBe(2);
        expect(castCap(testState(), at("s4"))).toBe(2);
        expect(phenomena(testState()).parts.find(p => p.key === "sustained")!.value).toBe(10);

        // Sorcery spells alone add nothing to the phenomena.
        updateSignalAtPath(testState(), `${at("s1")}.sustain.copies`, 0);
        expect([sustaining(testState()).any, phenomena(testState()).parts.find(p => p.key === "sustained")!.value]).toEqual([false, 0]);
    });

    it("counts the Sorcery spells towards their own limit, 2 with Expanded Sustain, and −10 while two are sustained", () => {
        loadMixed();
        expect(sorcerySustained(testState())).toMatchObject({ count: 2, limit: 1, penalty: -10, upkeep: 2 });
        expect(sorcerySustained(testState()).powers.map(p => [p.name, p.taken])).toEqual([["Delude", 0], ["Blur", 0]]);
        // Cast again, a spell ends its own sustaining first.
        expect(sorcerySustained(testState(), at("s2"))).toMatchObject({ count: 1, penalty: 0 });

        for (const name of ["  expanded   SUSTAIN ", "Расширенное поддержание"]) {
            loadMixed({ talents: { list: { items: { a1: { name } }, layouts: { a1: pos(0, 0) } } } });
            expect(sorcerySustained(testState()).limit, name).toBe(2);
        }
        // Nor counted while the sheet does not mark sustained spells.
        loadMixed({ settings: { psykana: { sustained: false } } });
        expect(sorcerySustained(testState())).toMatchObject({ count: 0, penalty: 0 });
    });

    it("prepares the PR spells only", () => {
        loadMixed();
        expect(preparedCount(testState())).toBe(1);
    });

    it("pays and restores each pool for the spells of its way", () => {
        loadMixed();
        const state = testState();
        const actions = recordingActions(state);
        expect([manaUpkeep(state), manaUpkeep(state, "focus.bard")]).toEqual([1, 2]);
        expect([canRestoreMana(state), canRestoreMana(state, "focus.bard")]).toEqual([false, false]);
        expect(manaShortage(state, 2)).toBeNull();
        expect(manaShortage(state, 2, "focus.bard")).toBe("Not enough Bardic Focus: the cast costs 2, 1 left");

        payMana({ state, actions }, 1, "focus.bard");
        expect([valueAt(state, "mana.current"), valueAt(state, "focus.bard.current")]).toEqual([2, 0]);
        payUpkeep({ state, actions });
        expect([valueAt(state, "mana.current"), valueAt(state, "focus.bard.current")]).toEqual([1, 0]);

        // A sustained PR spell does not block the Sorcery pool, nor the reverse.
        updateSignalAtPath(state, `${at("s2")}.sustain.copies`, 0);
        updateSignalAtPath(state, `${at("s3")}.sustain.copies`, 0);
        expect([canRestoreMana(state), canRestoreMana(state, "focus.bard")]).toEqual([false, true]);
        restoreMana({ state, actions }, "focus.bard");
        expect([valueAt(state, "mana.current"), valueAt(state, "focus.bard.current")]).toEqual([1, 4]);
        updateSignalAtPath(state, `${at("s2")}.sustain.copies`, 1);
        updateSignalAtPath(state, `${at("s1")}.sustain.copies`, 0);
        expect([canRestoreMana(state), canRestoreMana(state, "focus.bard")]).toEqual([true, false]);
    });

    it("counts every spell by PR on a Black Crusade sheet", () => {
        loadMixed({}, blackCrusade);
        expect(sustainedPowers(testState()).powers.map(p => p.name)).toEqual(["Bolt", "Delude", "Blur"]);
        expect(sustaining(testState()).taken).toBe(3);
        expect(sorcerySustained(testState()).count).toBe(0);
    });
});

describe("the Focus pools", () => {
    const sustained = (subtypes: string, x = 0) => ({
        subtypes: x ? `${subtypes}, Upkeep (${x})` : subtypes, sustained: "Free action", sustain: { copies: 1 },
    });
    /** A bard-ranger with a spell of each class and one of a class no variant names, the bard's sustained with Upkeep 1. */
    const spells = {
        s1: { name: "Delude", ...sustained("Sorcery (Bard)", 1) },
        s2: { name: "Jump", subtypes: "Колдовство (следопыт)" },
        s3: { name: "Thorns", subtypes: "Sorcery (Druid)" },
        s4: { name: "Shield" },
    };
    const at = (id: string) => `${POWERS}.${id}`;
    const pools = { focus: { bard: { current: 2, max: { base: "4" } }, ranger: { current: 3, max: { base: "5" } } } };

    it("are a Focus per half-caster class, and each spell pays from its class's, by its name in any language", () => {
        load(content(spells, pools));
        expect(focusPools(pathfinderCrusade.stats)).toEqual(["focus.bard", "focus.ranger"]);
        expect(["s1", "s2", "s3", "s4"].map(id => sorceryPool(testState(), at(id)))).toEqual(["focus.bard", "focus.ranger", null, null]);
        expect(["focus.bard", "focus.ranger"].map(pool => hasSorcerySpellOf(testState(), pool as "focus.bard"))).toEqual([true, true]);

        const state = testState();
        const actions = recordingActions(state);
        expect([manaShortage(state, 3, "focus.bard"), manaShortage(state, 3, "focus.ranger")])
            .toEqual(["Not enough Bardic Focus: the cast costs 3, 2 left", null]);
        payMana({ state, actions }, 2, "focus.ranger");
        expect([valueAt(state, "focus.bard.current"), valueAt(state, "focus.ranger.current"), valueAt(state, "mana.current")]).toEqual([2, 1, 0]);
    });

    it("block and pay the upkeep of the sustained spells of their class only", () => {
        load(content(spells, pools));
        const state = testState();
        const actions = recordingActions(state);
        expect([canRestoreMana(state, "focus.bard"), canRestoreMana(state, "focus.ranger"), canRestoreMana(state)]).toEqual([false, true, true]);
        expect([manaUpkeep(state, "focus.bard"), manaUpkeep(state, "focus.ranger")]).toEqual([1, 0]);
        restoreMana({ state, actions }, "focus.ranger");
        payUpkeep({ state, actions }, "focus.bard");
        expect([valueAt(state, "focus.bard.current"), valueAt(state, "focus.ranger.current")]).toEqual([1, 5]);

        // A ranger spell sustained blocks the Ranger Focus, and counts to the one limit of Sorcery.
        updateSignalAtPath(state, `${at("s2")}.sustain.copies`, 1);
        updateSignalAtPath(state, `${at("s2")}.sustained`, "Free action");
        expect([canRestoreMana(state, "focus.bard"), canRestoreMana(state, "focus.ranger")]).toEqual([false, false]);
        expect(sorcerySustained(state)).toMatchObject({ count: 2, limit: 1 });
    });

    it("leave a spell of a class no variant names unpaid, its sustaining blocking none of them", () => {
        load(content({ s3: { ...spells.s3, ...sustained("Sorcery (Druid)", 2) } }, pools));
        expect(sorceryPool(testState(), at("s3"))).toBeNull();
        expect([canRestoreMana(testState(), "focus.bard"), canRestoreMana(testState(), "focus.ranger")]).toEqual([true, true]);
        expect([manaUpkeep(testState(), "focus.bard"), manaUpkeep(testState(), "focus.ranger")]).toEqual([0, 0]);
        expect(sorcerySustained(testState()).count).toBe(1);
    });
});

describe("a Sorcery cast", () => {
    const S1 = `${POWERS}.s1`;
    const advances = (n: number) => Object.fromEntries(["plus0", "plus10", "plus20", "plus30"].slice(0, n).map(key => [key, true]));
    const talents = (...names: string[]) => ({
        list: { items: Object.fromEntries(names.map((name, i) => [`a${i}`, { name }])), layouts: Object.fromEntries(names.map((_, i) => [`a${i}`, pos(0, i)])) },
    });
    /** Delude tested on `roll`, with the skills and talents of `over`. */
    function loadCast(roll: object, over: object = {}, spells: Record<string, object> = {}) {
        load(content({ s1: { name: "Delude", subtypes: "Sorcery (Bard)", level: 2, roll }, ...spells }, over));
    }
    const cap = () => sorceryCap(testState(), S1);

    it("is tested on the skill of its roll, by the characteristic picked or the skill's own", () => {
        loadCast({ skill: "deceive" });
        expect(sorceryTest(testState(), `${S1}.roll`)).toBe("deceive");
        updateSignalAtPath(testState(), `${S1}.roll.characteristic`, "W");
        expect(sorceryTest(testState(), `${S1}.roll`)).toBe("deceive (W)");
        updateSignalAtPath(testState(), `${S1}.roll.skill`, "");
        expect(sorceryTest(testState(), `${S1}.roll`)).toBe("");
    });

    it("takes at most the level of the skill as its ePR, none untrained or gone from the sheet", () => {
        for (const [n, source] of [[0, "Max 0: Deceive is not trained"], [1, "Max 1: Deceive +0"], [3, "Max 3: Deceive +20"], [4, "Max 4: Deceive +30"]] as const) {
            loadCast({ skill: "deceive" }, { skillsLeft: { deceive: advances(n) } });
            expect(cap()).toEqual({ max: n, skill: "Deceive", source, hint: null });
        }
        loadCast({});
        expect(cap()).toEqual({ max: 0, skill: "", source: "", hint: null, lost: false });
        loadCast({ skill: "custom:c1" });
        expect(cap()).toMatchObject({ max: 0, skill: "", lost: true });
    });

    it("takes 5 with the Mastery of the skill in the talents, if the skill is at +30", () => {
        const mastered = (skill: string, over: object, ...names: string[]) => {
            loadCast({ skill }, { ...over, talents: talents("Hatred", ...names) });
            return cap().max;
        };
        const deceive = (n: number) => ({ skillsLeft: { deceive: advances(n) } });
        for (const name of ["Mastery (Deceive)", "  mastery(DECEIVE) ", "Мастерство ( Deceive )"]) expect(mastered("deceive", deceive(4), name), name).toBe(5);
        expect(cap().source).toBe("Max 5: Мастерство ( Deceive )");
        expect(mastered("deceive", deceive(3), "Mastery (Deceive)")).toBe(3);
        expect(mastered("deceive", deceive(4), "Mastery (Charm)")).toBe(4);

        const surface = { skillsLeft: { navigation_surface: advances(4) } };
        for (const name of ["Mastery (Navigation (Surface))", "Mastery (Surface)"]) expect(mastered("navigation_surface", surface, name), name).toBe(5);
        expect(cap().skill).toBe("Navigation: Surface");
        expect(mastered("navigation_surface", surface, "Mastery (Sea)")).toBe(4);

        for (const typed of ["Musician", "Trade (Musician)"]) {
            const trade = { skillsRight: { "1_trade": { name: typed, ...advances(4) } } };
            for (const name of ["Mastery (Musician)", "Mastery (Trade (Musician))"]) expect(mastered("1_trade", trade, name), `${typed}: ${name}`).toBe(5);
        }

        const herbalism = { customSkills: { list: { items: { c1: { name: "Herbalism", characteristic: "I", ...advances(4) } }, layouts: { c1: pos(0, 0) } } } };
        expect(mastered("custom:c1", herbalism, "Mastery (herbalism)")).toBe(5);

        // Named as a Magic test names skills: by what is in the parentheses too, dashes as spaces.
        const custom = (name: string) => ({ customSkills: { list: { items: { c1: { name, characteristic: "A", ...advances(4) } }, layouts: { c1: pos(0, 0) } } } });
        expect(mastered("custom:c1", custom("Trade (Dancer)"), "Mastery (Dancer)")).toBe(5);
        expect(mastered("custom:c1", custom("Sleight-of-Hand"), "Mastery (Sleight of Hand)")).toBe(5);
    });

    it("hints to name the skill of a bare Mastery while the skill is at +30", () => {
        loadCast({ skill: "deceive" }, { skillsLeft: { deceive: advances(4) }, talents: talents("Mastery") });
        expect(cap()).toMatchObject({ max: 4, hint: "Name its skill: Mastery (Deceive)" });
        loadCast({ skill: "deceive" }, { skillsLeft: { deceive: advances(3) }, talents: talents("Мастерство") });
        expect(cap()).toMatchObject({ max: 3, hint: null });
    });

    it("totals the skill, the modifier and the extras, without 5 per ePR, and −10 while two other spells are sustained", () => {
        const sustained = { subtypes: "Sorcery (Bard)", sustained: "Free action", sustain: { copies: 1 } };
        // F 40 at +10: 50; on W 30: 40.
        const roll = { skill: "deceive", modifier: -10, effectivePR: 2, extra1: { value: 5, enabled: true }, extra2: { value: 7 } };
        loadCast(roll, { skillsLeft: { deceive: advances(2) } }, { s2: { name: "Blur", ...sustained } });
        expect(sorceryTotal(testState(), S1, true)).toBe(45);
        updateSignalAtPath(testState(), `${S1}.roll.characteristic`, "W");
        expect(sorceryTotal(testState(), S1, true)).toBe(35);
        expect(sorceryCost(testState(), S1)).toBe(2);

        loadCast(roll, { skillsLeft: { deceive: advances(2) } }, { s2: { name: "Blur", ...sustained }, s3: { name: "Haste", ...sustained } });
        expect(sorceryTotal(testState(), S1, true)).toBe(35);
        // Delude sustained itself ends its sustaining when cast again to be sustained: one other is sustained.
        updateSignalAtPath(testState(), `${POWERS}.s3.sustain.copies`, 0);
        updateSignalAtPath(testState(), `${S1}.sustain.copies`, 1);
        updateSignalAtPath(testState(), `${S1}.sustained`, "Free action");
        expect(sorceryTotal(testState(), S1, true)).toBe(45);
        // Cast not to be sustained, it leaves its sustaining on: two are.
        expect(sorceryTotal(testState(), S1, false)).toBe(35);
        // One that cannot be sustained, or a Repeatable one, keeps its sustained casts either way.
        updateSignalAtPath(testState(), `${S1}.sustained`, "No");
        expect(sorceryTotal(testState(), S1, true)).toBe(35);
        updateSignalAtPath(testState(), `${S1}.sustained`, "Free action");
        updateSignalAtPath(testState(), `${S1}.subtypes`, "Sorcery (Bard), Repeatable (2)");
        expect(sorceryTotal(testState(), S1, true)).toBe(35);

        // Untrained: −20, as any test of the skill.
        loadCast({ skill: "deceive" });
        expect(sorceryTotal(testState(), S1, true)).toBe(20);
        loadCast({});
        expect(sorceryTotal(testState(), S1, true)).toBe(0);
    });
});
