import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet, testState } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import {
    castCharacteristic, giftOf, hasSpellcasting, poolBase, prCap, prCapWarning, preparesBySpellcasting, spellVariant, tickedVariants,
} from "./spellcasting";
import { resolvePath, updateSignalAtPath, valueAt } from "./sync";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const POWERS = "psykana.tabs.items.t1.powers.items";

/** A sheet of `spells`, by id, in one tab. */
const content = (spells: Record<string, object>, over: object = {}) => ({
    characteristics: { I: { value: "40" }, W: { value: "30" }, P: { value: "20" }, F: { value: "35" } },
    psykana: {
        tabs: {
            items: { t1: { name: "Tab", powers: { items: spells, layouts: Object.fromEntries(Object.keys(spells).map((id, i) => [id, pos(i % 2, i >> 1)])) } } },
            layouts: { t1: pos(0, 0) },
        },
    },
    ...over,
});

function load(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
    return testState();
}

afterEach(teardownSheet);

const keys = (path: string) => Object.keys(resolvePath(testState(), path) as object);

describe("the data of Spellcasting", () => {
    it("is a checkbox per variant, a Focus per half-caster class and the variant of a spell's roll in Pathfinder Crusade", () => {
        const state = load(content({ s1: { name: "Bolt", roll: { spellcasting: "divine" } } }, {
            spellcasting: { arcane: true, bard: true },
            focus: { bard: { current: 2, max: { base: "4" } } },
        }));
        expect(pathfinderCrusade.stats.spellcasting.map(v => v.key)).toEqual(["arcane", "divine", "spontaneous", "bard", "ranger"]);
        expect(keys("spellcasting")).toEqual(["arcane", "divine", "spontaneous", "bard", "ranger"]);
        expect(["arcane", "divine", "bard"].map(key => valueAt(state, `spellcasting.${key}`))).toEqual([true, false, true]);
        expect(keys("focus")).toEqual(["bard", "ranger"]);
        expect([valueAt(state, "focus.bard.current"), valueAt(state, "focus.bard.max.base"), valueAt(state, "focus.ranger.current")]).toEqual([2, "4", 0]);
        expect(valueAt(state, `${POWERS}.s1.roll.spellcasting`)).toBe("divine");
    });

    it("offers no Daemonic gift in Pathfinder Crusade", () => {
        expect(pathfinderCrusade.stats.psykanaTypes).toEqual(["Arcane", "Bound", "Unbound"]);
        expect(blackCrusade.stats.psykanaTypes).toContain("Daemonic");
    });

    it("is none of a Black Crusade sheet", () => {
        const state = load(content({ s1: { name: "Bolt", roll: { spellcasting: "divine" } } }, {
            spellcasting: { arcane: true }, focus: { bard: { current: 2 } },
        }), blackCrusade);
        expect(blackCrusade.stats.spellcasting).toEqual([]);
        expect(["spellcasting" in state, "focus" in state]).toEqual([false, false]);
        expect(keys(`${POWERS}.s1.roll`)).not.toContain("spellcasting");
    });
});

describe("the rules of the variants", () => {
    /** I 40, W 30, P 20, F 35 and base PR 2, a PR spell s1, s2 picking Divine, s3 picking Spontaneous and a bard spell s4. */
    const spells = {
        s1: { name: "Bolt" },
        s2: { name: "Heal", roll: { spellcasting: "divine" } },
        s3: { name: "Haste", roll: { spellcasting: "spontaneous" } },
        s4: { name: "Delude", subtypes: "Sorcery (Bard)" },
    };
    const sheet = (ticked: string[], over: object = {}) => load(content(spells, {
        spellcasting: Object.fromEntries(ticked.map(key => [key, true])),
        ...over,
        psykana: { ...content(spells).psykana, basePR: 2, psykanaType: "Unbound" },
    }));
    const spell = (id: string) => `${POWERS}.${id}`;
    /** What the variants make of the spell s1 and of the sheet. */
    const rules = (state: ReturnType<typeof load>) => ({
        variant: spellVariant(state, spell("s1"))?.key ?? null,
        gift: giftOf(state, spell("s1")),
        cast: castCharacteristic(state, spell("s1")),
        prepares: preparesBySpellcasting(state),
        mana: poolBase(state, "mana").base,
        bard: poolBase(state, "focus.bard").base,
        ranger: poolBase(state, "focus.ranger").base,
        cap: prCap(state),
    });

    it("give a PR spell, alone, its gift, its Cast, its preparation and the base of the mana", () => {
        expect(rules(sheet(["arcane"]))).toEqual({
            variant: "arcane", gift: "Arcane", cast: "I", prepares: true, mana: "2×I.b+2×bPR", bard: "0", ranger: "0", cap: { characteristic: "I", bonus: 4 },
        });
        expect(poolBase(testState(), "mana").source).toBe("Arcane 12");
        expect(rules(sheet(["divine"]))).toMatchObject({ variant: "divine", gift: "Bound", cast: "W", prepares: true, mana: "W.b+I.b+2×bPR", cap: { characteristic: "W", bonus: 3 } });
        expect(rules(sheet(["spontaneous"]))).toMatchObject({ variant: "spontaneous", gift: "Unbound", cast: "W", prepares: false, mana: "W.b+P.b+2×bPR" });
    });

    it("give a half-caster, alone, the base of its Focus and nothing of PR", () => {
        expect(rules(sheet(["bard"]))).toEqual({ variant: null, gift: "", cast: "W", prepares: false, mana: "0", bard: "F.b", ranger: "0", cap: null });
        expect(poolBase(testState(), "focus.bard").source).toBe("Bard 3");
        expect(rules(sheet(["ranger"]))).toMatchObject({ bard: "0", ranger: "P.b" });
    });

    it("of Arcane and Divine cast each spell by the one it picks, the first without, and take the larger mana", () => {
        const state = sheet(["arcane", "divine"]);
        expect(tickedVariants(state).map(v => v.key)).toEqual(["arcane", "divine"]);
        // Spontaneous is not ticked: s3 casts by the first.
        expect(["s1", "s2", "s3"].map(id => [spellVariant(state, spell(id))!.key, giftOf(state, spell(id)), castCharacteristic(state, spell(id))]))
            .toEqual([["arcane", "Arcane", "I"], ["divine", "Bound", "W"], ["arcane", "Arcane", "I"]]);
        expect(poolBase(state, "mana")).toEqual({ base: "2×I.b+2×bPR", source: "Arcane 12; Divine 11" });
        expect(prCap(state)).toEqual({ characteristic: "I", bonus: 4 });

        // A wiser cleric: Divine's is the larger.
        sheet(["arcane", "divine"], { characteristics: { I: { value: "40" }, W: { value: "60" } } });
        expect(poolBase(testState(), "mana")).toEqual({ base: "W.b+I.b+2×bPR", source: "Arcane 12; Divine 14" });
        expect(prCap(testState())).toEqual({ characteristic: "W", bonus: 6 });
    });

    it("of Bard and Ranger give each Focus its base and no mana", () => {
        expect(rules(sheet(["bard", "ranger"]))).toMatchObject({ variant: null, mana: "0", bard: "F.b", ranger: "P.b", cap: null, prepares: false });
    });

    it("of Arcane and Bard cast the PR spells by Arcane and the bard's by Sorcery", () => {
        const state = sheet(["arcane", "bard"]);
        expect(rules(state)).toMatchObject({ variant: "arcane", gift: "Arcane", prepares: true, mana: "2×I.b+2×bPR", bard: "F.b", ranger: "0" });
        expect([spellVariant(state, spell("s4")), giftOf(state, spell("s4"))]).toEqual([null, ""]);
    });

    it("ticked none, give no gift, no preparation, bases 0 and Cast on W", () => {
        expect(rules(sheet([]))).toEqual({ variant: null, gift: "", cast: "W", prepares: false, mana: "0", bard: "0", ranger: "0", cap: null });
        expect(poolBase(testState(), "mana").source).toBe("");
        expect(prCapWarning(testState())).toBeNull();
    });

    it("warn of a base PR past the bonus of the casting characteristic", () => {
        expect(prCapWarning(sheet(["divine"]))).toBeNull();
        updateSignalAtPath(testState(), "psykana.basePR", 4);
        expect(prCapWarning(testState())).toBe("PR grows up to W.b (3)");
        updateSignalAtPath(testState(), "spellcasting.arcane", true);
        expect(prCapWarning(testState())).toBeNull();
    });

    it("are none of a Black Crusade sheet, whose powers take the gift picked", () => {
        const state = load(content(spells, { spellcasting: { arcane: true }, psykana: { ...content(spells).psykana, psykanaType: "Unbound" } }), blackCrusade);
        expect([hasSpellcasting(state), tickedVariants(state), spellVariant(state, spell("s2"))]).toEqual([false, [], null]);
        expect([giftOf(state, spell("s1")), castCharacteristic(state, spell("s1")), preparesBySpellcasting(state), prCap(state)]).toEqual(["Unbound", "W", false, null]);
    });
});
