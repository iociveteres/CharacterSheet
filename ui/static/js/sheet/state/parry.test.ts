import { afterEach, describe, expect, it } from "vitest";
import { conditionOf, loadState, teardownSheet } from "../components/testUtils";
import { attachComputeds } from "./computed";
import { parryAt, parryModValue } from "./parry";

afterEach(teardownSheet);

const A = "meleeAttacks.list.items.m1";

/** WS 45, Parry trained (+0), bPR 3; a melee attack of `attack` with `special`, its parry modifiers `mods`. */
function parry(attack: object, { special = "", mods = [] as string[], extra = {} } = {}) {
    const state = loadState({
        characteristics: { WS: { value: "45" }, S: { value: "40" } },
        skillsLeft: { parry: { characteristic: "WS", plus0: true } },
        psykana: { basePR: 3 },
        meleeAttacks: { list: { items: { m1: {
            ...attack,
            tabs: { items: { t1: { profile: "sword", special } }, layouts: { t1: { colIndex: 0, rowIndex: 0 } } },
            parryMods: {
                items: Object.fromEntries(mods.map((expr, i) => [`p${i}`, { expr: expr.replace(/^off:/, ""), enabled: !expr.startsWith("off:") }])),
                layouts: Object.fromEntries(mods.map((_, i) => [`p${i}`, { colIndex: 0, rowIndex: i }])),
            },
        } }, layouts: { m1: { colIndex: 0, rowIndex: 0 } } } },
        ...extra,
    });
    attachComputeds(state);
    return { state, parry: parryAt(state, A) };
}

describe("Parry with a melee weapon", () => {
    it("is the Parry skill with the modifier of the Balance", () => {
        expect(parry({ balance: "0" }).parry).toMatchObject({ value: 45, text: "45", canParry: true, lines: [{ text: "45", label: "Parry (WS)" }] });
        expect(parry({ balance: "-1" }).parry.value).toBe(35);
        expect(parry({ balance: "1" }).parry.value).toBe(55);
        expect(parry({ balance: "2" }).parry).toMatchObject({ value: 60, lines: [{ text: "45" }, { text: "+15", label: "Balance 2" }] });
        // No Balance, as a shield: 0.
        expect(parry({}).parry.value).toBe(45);
    });

    it("cannot parry at Balance −2, but still counts the rest for a roll", () => {
        expect(parry({ balance: "-2" }).parry).toMatchObject({ canParry: false, text: "—", value: 45 });
        // The grip can bring the Balance there.
        expect(parry({ balance: "2", grip: "2р [Бл]", gripSelected: "Cl" }).parry).toMatchObject({ canParry: false, text: "—" });
    });

    it("adds 15 for Defensive and the WS of the grip", () => {
        expect(parry({ grip: "1р+П" }, { special: "Defensive, Primitive" }).parry)
            .toMatchObject({ value: 60, lines: [{ text: "45" }, { text: "+15", label: "Defensive" }] });
        // 1h: Balance 2 − 1 is +10, WS −5.
        expect(parry({ balance: "2", grip: "2р [1р]", gripSelected: "1h" }).parry)
            .toMatchObject({ value: 50, lines: [{ text: "45" }, { text: "+10", label: "Balance 1" }, { text: "-5", label: "1h" }] });
    });

    it("adds its enabled modifiers that read as numbers", () => {
        expect(parry({ balance: "0" }, { mods: ["3×bPR", "-5", "off:10", "1d10", "Q.b"] }).parry)
            .toMatchObject({ value: 49, lines: [{ text: "45" }, { text: "+9", label: "3×bPR" }, { text: "-5", label: "-5" }] });
    });

    it("follows the skill's entries and characteristic", () => {
        const withBonus = parry({ balance: "0" }, { extra: { conditions: conditionOf({ type: "skill_bonus", name: "Parry", skillBonus: "-10" }) } });
        expect(withBonus.parry.value).toBe(35);
    });
});

describe("a parry modifier", () => {
    it("reads numbers and references, not dice", () => {
        const { state } = parry({});
        expect(parryModValue(state, A, "3×bPR")).toBe(9);
        expect(parryModValue(state, A, "+10")).toBe(10);
        expect(parryModValue(state, A, "½WS.b")).toBe(2);
        expect(parryModValue(state, A, "1d10")).toBeNull();
        expect(parryModValue(state, A, "X")).toBeNull();
        expect(parryModValue(state, A, "")).toBeNull();
    });
});
