import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet } from "../components/testUtils";
import { attachComputeds } from "./computed";
import { WEAPON_DAMAGE, statAt } from "./damage";
import { balanceAt, gripProperties, meleeAttackBonus, meleeRangeAt } from "./melee";

afterEach(teardownSheet);

const A = "meleeAttacks.list.items.m1";
const T = `${A}.tabs.items.t1`;

/** S 40 (S.b 4); a melee attack of `attack` with the profile `tab` and the damage modifier S.b. */
function weapon(attack: object, tab: object = {}) {
    const state = loadState({
        characteristics: { S: { value: "40" } },
        meleeAttacks: { list: { items: { m1: { ...attack, tabs: {
            items: { t1: { profile: "sword", range: "2-5", damage: "1d10+2", pen: "0", ...tab,
                damageMods: { items: { d1: { expr: "S.b", enabled: true } }, layouts: { d1: { colIndex: 0, rowIndex: 0 } } } } },
            layouts: { t1: { colIndex: 0, rowIndex: 0 } },
        } } }, layouts: { m1: { colIndex: 0, rowIndex: 0 } } } },
    });
    attachComputeds(state);
    return state;
}

const longsword = (gripSelected = "", tab: object = {}) => weapon({ grip: "2р [1р, Бл, Мх]", gripSelected, balance: "2" }, tab);

describe("the grip of a melee weapon", () => {
    it("is the primary while none or a gone one is selected", () => {
        expect(meleeRangeAt(longsword(), T)).toMatchObject({ text: "2-5", lines: [] });
        expect(meleeRangeAt(longsword("Fist"), T)).toMatchObject({ text: "2-5", lines: [] });
        expect(balanceAt(longsword(), A)).toMatchObject({ value: 2, text: "2", lines: [] });
    });

    it("changes the Range: additions, then the values set, then not below 0", () => {
        expect(meleeRangeAt(longsword("1h"), T)).toMatchObject({ text: "3-6", lines: [{ text: "+1", label: "1h" }] });
        expect(meleeRangeAt(longsword("Cl"), T)).toMatchObject({ text: "0-3", lines: [{ text: "-2", label: "Cl" }] });
        expect(meleeRangeAt(longsword("Cl", { range: "1" }), T)).toMatchObject({ text: "0", lines: [{ text: "-2" }, { text: "≥ 0" }] });
        expect(meleeRangeAt(weapon({ grip: "2р [1р+Кл]", gripSelected: "1h+Fist" }, { range: "2-4" }), T).text).toBe("0");
        expect(meleeRangeAt(weapon({ grip: "Хв" }, { range: "2-4" }), T)).toMatchObject({ text: "0-4", lines: [{ text: "= 0 min", label: "Tail" }] });
    });

    it("leaves a Range that reads as none as typed", () => {
        expect(meleeRangeAt(longsword("1h", { range: "3 [3]" }), T)).toMatchObject({ text: "3 [3]", lines: [] });
        expect(meleeRangeAt(longsword("1h", { range: "4" }), T).text).toBe("5");
    });

    it("changes the Balance, set values last, from −2 to 2", () => {
        expect(balanceAt(longsword("1h"), A)).toMatchObject({ value: 1, text: "1", lines: [{ text: "-1", label: "1h" }] });
        expect(balanceAt(longsword("Cl"), A)).toMatchObject({ value: -2, lines: [{ text: "= -2", label: "Cl" }] });
        expect(balanceAt(weapon({ grip: "2р [1р]", gripSelected: "1h", balance: "-2" }), A))
            .toMatchObject({ value: -2, lines: [{ text: "-1" }, { text: "≥ -2" }] });
        expect(balanceAt(weapon({ grip: "2р", balance: "3" }), A)).toMatchObject({ value: 2, lines: [{ text: "≤ 2" }] });
        // A spear in one hand loses 2.
        expect(balanceAt(weapon({ grip: "2р [1р]", gripSelected: "1h", balance: "1" }, { profile: "spear" }), A).value).toBe(-1);
    });

    it("counts a weapon without a Balance, as a shield, as 0", () => {
        expect(balanceAt(weapon({ grip: "1р+П" }), A)).toMatchObject({ value: 0, text: "" });
        expect(balanceAt(weapon({ grip: "1р+П", balance: "?" }), A)).toMatchObject({ value: null, text: "?" });
    });

    it("changes the damage: 1h takes a die or 4, 2h and Mh add 3, Rev halves S.b, Fist takes 2", () => {
        const damage = (state: ReturnType<typeof weapon>) => statAt(state, WEAPON_DAMAGE, T, "damage");
        expect(damage(longsword())).toMatchObject({ text: "1d10+6", parts: ["S.b +4"] });
        expect(damage(longsword("1h"))).toMatchObject({ text: "1d10+2", parts: ["S.b +4", "1h -4"] });
        expect(damage(longsword("1h", { damage: "2d10" })).text).toBe("1d10+4");
        expect(damage(weapon({ grip: "1р [2р]", gripSelected: "2h" })).text).toBe("1d10+9");
        expect(damage(weapon({ grip: "1р [Об]", gripSelected: "Rev" }))).toMatchObject({ text: "1d10+4", parts: ["½S.b▲ (Rev) +2"] });
        expect(damage(weapon({ grip: "1р [Об]", gripSelected: "Rev" }, { profile: "spear" })).text).toBe("1d10+6");
        expect(damage(weapon({ grip: "2р [1р, 1р+Кл]", gripSelected: "1h+Fist" }, { profile: "axe" })).text).toBe("1d10");
        expect(damage(weapon({ grip: "2р [1р]", gripSelected: "1h" }, { profile: "spear" })).text).toBe("1d10+5");
    });

    it("in Mordhau uses the one-handed Mace's profile in two hands", () => {
        const state = longsword("Mh");
        expect(statAt(state, WEAPON_DAMAGE, T, "damage")).toMatchObject({ text: "1d10+8", own: "Mace 1d10+1", parts: ["S.b +4", "Mh, 2h +3"] });
        expect(statAt(state, WEAPON_DAMAGE, T, "pen")).toMatchObject({ text: "0", own: "Mace 0" });
        expect(meleeRangeAt(state, T)).toMatchObject({ base: "3", own: "Mace", text: "3" });
        expect(balanceAt(state, A)).toMatchObject({ base: "-1", own: "Mace", value: -1 });
    });

    it("adds its properties the Special does not name yet", () => {
        expect(gripProperties(longsword("Cl"), T)).toEqual(["Precise"]);
        expect(gripProperties(longsword("Cl", { special: "Precise, Balanced" }), T)).toEqual([]);
        expect(gripProperties(weapon({ grip: "Хв" }), T)).toEqual(["Cheap Shot"]);
        expect(gripProperties(longsword(), T)).toEqual([]);
    });

    it("gives the attacks its WS, and Defensive takes 10", () => {
        expect(meleeAttackBonus(longsword(), A)).toBe(0);
        expect(meleeAttackBonus(longsword("1h"), A)).toBe(-5);
        expect(meleeAttackBonus(longsword("Mh"), A)).toBe(-5);
        expect(meleeAttackBonus(weapon({ grip: "2р [1р+Об]", gripSelected: "1h+Rev" }), A)).toBe(-15);
        expect(meleeAttackBonus(weapon({ grip: "1р+П" }, { special: "Defensive, Primitive" }), A)).toBe(-10);
    });
});
