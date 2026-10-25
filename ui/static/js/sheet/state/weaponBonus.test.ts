import { afterEach, describe, expect, it } from "vitest";
import { conditionOf, loadState, teardownSheet } from "../components/testUtils";
import { attachComputeds } from "./computed";
import { WEAPON_DAMAGE, statAt } from "./damage";
import { balanceAt, meleeRangeAt } from "./melee";
import { rangeAt } from "./range";
import { unknownWeaponWords, weaponBonuses } from "./weaponBonus";

afterEach(teardownSheet);

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const M1 = "meleeAttacks.list.items.m1";
const T1 = `${M1}.tabs.items.t1`;
const R1 = "rangedAttacks.list.items.r1";

/** A Longsword (sword, Primary), a Glaive (Power) and a Bolter (rifle) under a condition of `entries`, at `stacks`. */
function sheet(entries: object[], stacks = 1) {
    const conditions = conditionOf(...entries.map(e => ({ type: "weapon_bonus", ...e })));
    conditions.list.items.c1.name = "Longarm";
    conditions.list.items.c1.stacks = stacks;
    const state = loadState({
        conditions,
        meleeAttacks: {
            list: {
                items: {
                    m1: { name: "Longsword", group: "primary", balance: "1", tabs: { items: { t1: { profile: "sword", range: "2-4", damage: "1d10+2", pen: "1" } }, layouts: { t1: pos(0, 0) } } },
                    m2: { name: "Glaive", group: "power", tabs: { items: { t1: { profile: "glaive", range: "3-5", damage: "1d10" } }, layouts: { t1: pos(0, 0) } } },
                },
                layouts: { m1: pos(0, 0), m2: pos(0, 1) },
            },
        },
        rangedAttacks: { list: { items: { r1: { name: "Bolter", class: "rifle", range: "100м", damage: "1d10+5", pen: "4" } }, layouts: { r1: pos(0, 0) } } },
    });
    attachComputeds(state);
    return state;
}

describe("a weapon entry", () => {
    it("adds to the Range of the melee weapons it names: both ends, or the minimum or maximum", () => {
        expect(meleeRangeAt(sheet([{ name: "Melee", weaponField: "rng", weaponBonus: "1" }]), T1))
            .toMatchObject({ text: "3-5", lines: [{ text: "+1", label: "Longarm" }] });
        expect(meleeRangeAt(sheet([{ name: "Melee", weaponField: "rngMax", weaponBonus: "1" }]), T1))
            .toMatchObject({ text: "2-5", lines: [{ text: "+1 max", label: "Longarm" }] });
        expect(meleeRangeAt(sheet([{ name: "Melee", weaponField: "rngMin", weaponBonus: "-3" }]), T1))
            .toMatchObject({ text: "0-4", lines: [{ text: "-3 min" }, { text: "≥ 0" }] });
    });

    it("counts before the values a grip sets", () => {
        const state = sheet([{ name: "sword", weaponField: "rng", weaponBonus: "2" }]);
        // Fist sets the Rng to 0 whatever was added.
        state.meleeAttacks.list.items.m1.grip.value = "2р [Кл]";
        state.meleeAttacks.list.items.m1.gripSelected.value = "Fist";
        expect(meleeRangeAt(state, T1).text).toBe("0");
    });

    it("names the weapons by kind, group or class, profile or name, in any case; X counts the stacks", () => {
        const range = (name: string) => meleeRangeAt(sheet([{ name, weaponField: "rngMax", weaponBonus: "X" }], 2), T1).text;
        for (const name of ["melee", "Primary", "SWORD", "longsword", "glaive, sword"]) expect(range(name)).toBe("2-6");
        for (const name of ["Ranged", "Power", "glaive", "rifle", "Bolter"]) expect(range(name)).toBe("2-4");
    });

    it("is off with a word that names nothing", () => {
        const state = sheet([{ name: "sword, Halberd", weaponField: "rngMax", weaponBonus: "1" }]);
        expect(meleeRangeAt(state, T1).text).toBe("2-4");
        expect(unknownWeaponWords(state, "sword, Halberd, Power, primary (shield), bolter")).toEqual(["halberd"]);
    });

    it("adds to the Balance, within −2 and 2", () => {
        expect(balanceAt(sheet([{ name: "Longsword", weaponField: "balance", weaponBonus: "1" }]), M1))
            .toMatchObject({ value: 2, lines: [{ text: "+1", label: "Longarm" }] });
        expect(balanceAt(sheet([{ name: "Longsword", weaponField: "balance", weaponBonus: "3" }]), M1).value).toBe(2);
    });

    it("adds to the damage and penetration of melee profiles and ranged attacks, named by its source", () => {
        const state = sheet([{ name: "Melee, Ranged", weaponField: "dmg", weaponBonus: "2" }, { name: "Bolter", weaponField: "pen", weaponBonus: "-1" }]);
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage")).toMatchObject({ text: "1d10+4", parts: ["Longarm +2"] });
        expect(statAt(state, WEAPON_DAMAGE, T1, "pen").text).toBe("1");
        expect(statAt(state, WEAPON_DAMAGE, R1, "damage").text).toBe("1d10+7");
        expect(statAt(state, WEAPON_DAMAGE, R1, "pen")).toMatchObject({ text: "3", parts: ["Longarm -1"] });
    });

    it("adds Rng and Rng max to the range of a ranged attack", () => {
        const state = sheet([{ name: "Ranged", weaponField: "rng", weaponBonus: "10" }, { name: "rifle", weaponField: "rngMax", weaponBonus: "5" }]);
        expect(rangeAt(state, R1).text).toBe("115м");
        expect(weaponBonuses(state, R1, "rngMin")).toEqual([]);
    });

    it("counts only while its condition is on", () => {
        const state = sheet([{ name: "Melee", weaponField: "rng", weaponBonus: "1" }]);
        state.conditions.list.items.c1.enabled.value = false;
        expect(meleeRangeAt(state, T1).text).toBe("2-4");
    });
});
