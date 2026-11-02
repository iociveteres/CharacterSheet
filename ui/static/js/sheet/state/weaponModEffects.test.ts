import { afterEach, describe, expect, it } from "vitest";
import { conditionOf, loadState, teardownSheet } from "../components/testUtils";
import { attachComputeds, gearWeight } from "./computed";
import { WEAPON_DAMAGE, statAt } from "./damage";
import type { GearItem } from "./materials";
import { balanceAt, meleeAttackBonus, meleeHitLines } from "./melee";
import { parryAt } from "./parry";
import { updateSignalAtPath } from "./sync";
import { hitLines } from "./weaponBonus";

afterEach(teardownSheet);

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (...rows: object[]) => ({
    items: Object.fromEntries(rows.map((r, i) => [`e${i}`, r])),
    layouts: Object.fromEntries(rows.map((_, i) => [`e${i}`, pos(0, i)])),
});
const thisItem = (weaponField: string, weaponBonus: string) => ({ type: "weapon_bonus", name: "This item", weaponField, weaponBonus });

const G1 = "gear.list.items.g1";
const M1 = "meleeAttacks.list.items.m1";
const R1 = "rangedAttacks.list.items.r1";

/** The rulebook's Weighted: +20% weight, Dmg +3, Balance −1, −10 to hit and to Parry. */
const weighted = {
    name: "Weighted", weightFactor: 1.2,
    entries: grid(thisItem("dmg", "3"), thisItem("balance", "-1"), thisItem("hit", "-10"), thisItem("parry", "-10")),
};

/**
 * WS 45 and BS 40, Parry trained: a Longsword (5 kg) of the gear with `mods`,
 * the Longsword attack linked to it (Balance 1), a Lasgun attack linked to
 * the Lasgun of the gear with `rangedMods`.
 */
function sheet({ mods = [] as object[], rangedMods = [] as object[], link = true, extra = {} } = {}) {
    const state = loadState({
        characteristics: { WS: { value: "45" }, BS: { value: "40" } },
        skillsLeft: { parry: { characteristic: "WS", plus0: true } },
        gear: {
            list: {
                items: {
                    g1: { name: "Longsword", weight: 5, gearType: "weapon", weapon: { mods: grid(...mods) } },
                    g2: { name: "Lasgun", weight: 4, gearType: "weapon", weapon: { mods: grid(...rangedMods) } },
                },
                layouts: { g1: pos(0, 0), g2: pos(0, 1) },
            },
        },
        meleeAttacks: {
            list: {
                items: {
                    m1: {
                        name: "Longsword", group: "primary", balance: "1", item: link ? "g1" : "",
                        tabs: { items: { t1: { profile: "sword", damage: "1d10+2", pen: "0" } }, layouts: { t1: pos(0, 0) } },
                    },
                },
                layouts: { m1: pos(0, 0) },
            },
        },
        rangedAttacks: {
            list: { items: { r1: { name: "Lasgun", class: "rifle", damage: "1d10+3", pen: "0", item: link ? "g2" : "" } }, layouts: { r1: pos(0, 0) } },
        },
        ...extra,
    });
    attachComputeds(state);
    return state;
}

const item = (state: ReturnType<typeof sheet>, id = "g1") => state.gear.list.items[id] as GearItem;

describe("the weight factor of a weapon mod", () => {
    it("multiplies the item's own weight, named by the mod, but its mods' weights", () => {
        const state = sheet({ mods: [weighted, { name: "Scope", weight: 0.5 }] });
        expect(gearWeight(item(state))).toMatchObject({ own: 5, factors: [{ factor: 1.2, source: "Weighted" }], mods: 0.5, total: 6.5 });
    });

    it("is weightless at 0, reads as 1 when cleared and counts only while the item is a weapon", () => {
        const state = sheet({ mods: [{ name: "Suspensors", weightFactor: 0 }] });
        expect(gearWeight(item(state)).total).toBe(0);
        updateSignalAtPath(state, `${G1}.weapon.mods.items.e0.weightFactor`, null);
        expect(gearWeight(item(state))).toMatchObject({ factors: [], total: 5 });
        updateSignalAtPath(state, `${G1}.weapon.mods.items.e0.weightFactor`, 0.5);
        updateSignalAtPath(state, `${G1}.gearType`, "tool");
        expect(gearWeight(item(state)).total).toBe(5);
    });

    it("of Metal Rim is counted once, by the rim's name", () => {
        const state = sheet({ mods: [{ name: "Metal Rim", weightFactor: 1.1 }] });
        expect(gearWeight(item(state)).factors).toEqual([{ factor: 1.1, source: "Metal Rim" }]);
    });
});

describe("the entries of a weapon mod", () => {
    it("count for the attack linked to the item, equipped or not", () => {
        const state = sheet({ mods: [weighted] });
        const T1 = `${M1}.tabs.items.t1`;
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage")).toMatchObject({ text: "1d10+5", parts: ["Weighted (Longsword) +3"] });
        expect(balanceAt(state, M1)).toMatchObject({ value: 0, lines: [{ text: "-1", label: "Weighted (Longsword)" }] });
        expect(meleeHitLines(state, M1, null)).toEqual([{ label: "Weighted (Longsword) -10", add: -10 }]);
        expect(parryAt(state, M1).lines).toContainEqual({ text: "-10", label: "Weighted (Longsword)" });
    });

    it("count for no attack without the link, nor while the item is no weapon", () => {
        expect(meleeHitLines(sheet({ mods: [weighted], link: false }), M1, null)).toEqual([]);
        const state = sheet({ mods: [weighted] });
        updateSignalAtPath(state, `${G1}.gearType`, "armour");
        expect(statAt(state, WEAPON_DAMAGE, `${M1}.tabs.items.t1`, "damage").text).toBe("1d10+2");
        expect(meleeHitLines(state, M1, null)).toEqual([]);
    });
});

describe("a weapon entry of Hit", () => {
    it("adds a labelled line to the melee attack rolls after the profile's type", () => {
        const grip = { name: "Custom Grip", entries: grid(thisItem("hit", "5"), thisItem("parry", "5")) };
        const state = sheet({ mods: [grip] });
        const base = meleeAttackBonus(sheet(), M1);
        expect(meleeAttackBonus(state, M1) - base).toBe(5);
        updateSignalAtPath(state, `${M1}.tabs.items.t1.profile`, "mace");
        expect(meleeHitLines(state, M1, null)).toEqual([{ label: "mace", add: 10 }, { label: "Custom Grip (Longsword) +5", add: 5 }]);
    });

    it("adds to the ranged attack rolls, and counts by the words of a condition too", () => {
        const state = sheet({
            rangedMods: [{ name: "Custom Grip", entries: grid(thisItem("hit", "5")) }],
            extra: { conditions: conditionOf({ type: "weapon_bonus", name: "Ranged", weaponField: "hit", weaponBonus: "10" }) },
        });
        expect(hitLines(state, R1)).toEqual([{ label: "Test +10", add: 10 }, { label: "Custom Grip (Lasgun) +5", add: 5 }]);
        // A condition of Ranged gives the melee attack nothing.
        expect(meleeHitLines(state, M1, null)).toEqual([]);
    });
});

describe("a weapon entry of Parry", () => {
    it("adds a line to the Parry of the weapon after its own modifiers", () => {
        const state = sheet({ mods: [{ name: "Duelist Grip", entries: grid(thisItem("parry", "5")) }] });
        // Balance 1: +10.
        expect(parryAt(state, M1)).toMatchObject({
            value: 60, lines: [{ text: "45" }, { text: "+10", label: "Balance 1" }, { text: "+5", label: "Duelist Grip (Longsword)" }],
        });
    });
});
