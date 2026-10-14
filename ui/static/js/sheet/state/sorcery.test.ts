import { afterEach, describe, expect, it } from "vitest";
import { loadState, recordingActions, teardownSheet, testState } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { canRestoreMana, manaShortage, manaUpkeep, payMana, payUpkeep, restoreMana } from "./mana";
import { preparedCount } from "./prepared";
import { castCap, hasSorcery, isSorcery, phenomena, sustainedPowers, sustaining } from "./psychic";
import { sorcerySustained } from "./sorcery";
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
        load(content({ s1: delude }, { sorceryMana: { current: 2, max: { base: "F.b" } } }));
        expect(valueAt(testState(), `${POWERS}.s1.level`)).toBe(1);
        expect(valueAt(testState(), `${POWERS}.s1.roll.skill`)).toBe("deceive");
        expect(valueAt(testState(), `${POWERS}.s1.roll.characteristic`)).toBe("W");
        // The fields of the shared roll stay.
        expect(valueAt(testState(), `${POWERS}.s1.roll.modifier`)).toBe(-10);
        expect(valueAt(testState(), "sorceryMana.current")).toBe(2);
        expect(valueAt(testState(), "sorceryMana.max.base")).toBe("F.b");

        load(content({ s1: { name: "Shield" } }));
        expect([valueAt(testState(), `${POWERS}.s1.level`), valueAt(testState(), "sorceryMana.current")]).toEqual([0, 0]);
    });

    it("is none of a Black Crusade sheet", () => {
        load(content({ s1: delude }, { sorceryMana: { current: 2 } }), blackCrusade);
        expect(keys(`${POWERS}.s1`)).not.toContain("level");
        expect(keys(`${POWERS}.s1.roll`)).not.toContain("skill");
        expect(keys(`${POWERS}.s1.roll`)).not.toContain("characteristic");
        expect("sorceryMana" in testState()).toBe(false);
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
            sorceryMana: { current: 1, max: { base: "F.b" } },
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
        expect([manaUpkeep(state), manaUpkeep(state, "sorceryMana")]).toEqual([1, 2]);
        expect([canRestoreMana(state), canRestoreMana(state, "sorceryMana")]).toEqual([false, false]);
        expect(manaShortage(state, 2)).toBeNull();
        expect(manaShortage(state, 2, "sorceryMana")).toBe("Not enough mana: the cast costs 2, 1 left");

        payMana({ state, actions }, 1, "sorceryMana");
        expect([valueAt(state, "mana.current"), valueAt(state, "sorceryMana.current")]).toEqual([2, 0]);
        payUpkeep({ state, actions });
        expect([valueAt(state, "mana.current"), valueAt(state, "sorceryMana.current")]).toEqual([1, 0]);

        // A sustained PR spell does not block the Sorcery pool, nor the reverse.
        updateSignalAtPath(state, `${at("s2")}.sustain.copies`, 0);
        updateSignalAtPath(state, `${at("s3")}.sustain.copies`, 0);
        expect([canRestoreMana(state), canRestoreMana(state, "sorceryMana")]).toEqual([false, true]);
        restoreMana({ state, actions }, "sorceryMana");
        expect([valueAt(state, "mana.current"), valueAt(state, "sorceryMana.current")]).toEqual([1, 4]);
        updateSignalAtPath(state, `${at("s2")}.sustain.copies`, 1);
        updateSignalAtPath(state, `${at("s1")}.sustain.copies`, 0);
        expect([canRestoreMana(state), canRestoreMana(state, "sorceryMana")]).toEqual([true, false]);
    });

    it("counts every spell by PR on a Black Crusade sheet", () => {
        loadMixed({}, blackCrusade);
        expect(sustainedPowers(testState()).powers.map(p => p.name)).toEqual(["Bolt", "Delude", "Blur"]);
        expect(sustaining(testState()).taken).toBe(3);
        expect(sorcerySustained(testState()).count).toBe(0);
    });
});
