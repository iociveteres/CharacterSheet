import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet } from "../components/testUtils";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { WEAPON_DAMAGE, statAt } from "./damage";
import { naturalTrait, pickedRating, profilesOf, traitLinkOf } from "./traitLink";
import { deleteItemFromState, updateSignalAtPath } from "./sync";

afterEach(teardownSheet);

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const M1 = "meleeAttacks.list.items.m1";
const T1 = `${M1}.tabs.items.t1`;
const PROFILES = pathfinderCrusade.stats.naturalWeapons;

/** A sheet with S 40 and the traits `names` (t0, t1…); one Claws attack, `m1`, linked to `trait`. */
function sheet(names: string[], trait = "t0") {
    const state = loadState({
        characteristics: { S: { value: "40" } },
        traits: {
            list: {
                items: Object.fromEntries(names.map((name, i) => [`t${i}`, { name }])),
                layouts: Object.fromEntries(names.map((_, i) => [`t${i}`, pos(0, i)])),
            },
        },
        meleeAttacks: {
            list: {
                items: {
                    m1: {
                        name: "Claws (Natural Weapons)", trait,
                        tabs: { items: { t1: { profile: "claws", damage: "1d10", pen: "0", damageMods: { items: { s: { expr: "S.b", enabled: true } }, layouts: { s: pos(0, 0) } } } }, layouts: { t1: pos(0, 0) } },
                    },
                },
                layouts: { m1: pos(0, 0) },
            },
        },
    }, pathfinderCrusade);
    attachComputeds(state);
    return state;
}

describe("the name of a Natural Weapons trait", () => {
    it.each([
        ["Natural Weapons (2)", { trait: "Natural Weapons", deadly: false, rating: 2, weapon: "" }],
        ["Deadly Natural Weapons (3)", { trait: "Deadly Natural Weapons", deadly: true, rating: 3, weapon: "" }],
        ["natural  weapons (2, Claws)", { trait: "Natural Weapons", deadly: false, rating: 2, weapon: "Claws" }],
        ["Естественное Оружие (4)", { trait: "Natural Weapons", deadly: false, rating: 4, weapon: "" }],
        ["Natural Weapons (X)", { trait: "Natural Weapons", deadly: false, rating: null, weapon: "" }],
        ["Natural Weapons", { trait: "Natural Weapons", deadly: false, rating: null, weapon: "" }],
    ])("reads %s", (name, want) => {
        expect(naturalTrait(name)).toEqual(want);
    });

    it("is no other trait", () => {
        expect(naturalTrait("Natural Armour (2)")).toBeNull();
        expect(naturalTrait("Unnatural Weapons (2)")).toBeNull();
    });

    it("gives the weapon its Y names, or all seven", () => {
        expect(profilesOf(PROFILES, naturalTrait("Natural Weapons (2, Claw)")!).map(p => p.name)).toEqual(["Claws"]);
        expect(profilesOf(PROFILES, naturalTrait("Natural Weapons (2, Когти)")!).map(p => p.name)).toEqual(["Claws"]);
        expect(profilesOf(PROFILES, naturalTrait("Natural Weapons (2, Wings)")!)).toHaveLength(7);
        expect(profilesOf(PROFILES, naturalTrait("Natural Weapons (2)")!)).toHaveLength(7);
    });
});

describe("a melee attack linked to a Natural Weapons trait", () => {
    it("adds X to the damage, named by the trait, and reads it again when the trait is renamed", () => {
        const state = sheet(["Natural Weapons (2)"]);
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage").text).toBe("1d10+6");
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage").added).toEqual([{ text: "+2", label: "Natural Weapons (2)" }]);
        expect(statAt(state, WEAPON_DAMAGE, T1, "pen").text).toBe("0");

        updateSignalAtPath(state, "traits.list.items.t0.name", "Natural Weapons (3)");
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage").text).toBe("1d10+7");
    });

    it("adds X to the Pen too when the trait is Deadly", () => {
        const state = sheet(["Natural Weapons (2)", "Deadly Natural Weapons (3)"], "t1");
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage").text).toBe("1d10+7");
        expect(statAt(state, WEAPON_DAMAGE, T1, "pen").text).toBe("3");
        expect(statAt(state, WEAPON_DAMAGE, T1, "pen").added).toEqual([{ text: "+3", label: "Deadly Natural Weapons (3)" }]);
    });

    it("counts X as 0 when the trait's name has no number", () => {
        const state = sheet(["Natural Weapons (X)"]);
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage").text).toBe("1d10+4");
        expect(traitLinkOf(state, T1)?.natural?.rating).toBeNull();
    });

    it("gets nothing of a deleted trait or one renamed into another", () => {
        const state = sheet(["Natural Weapons (2)"]);
        updateSignalAtPath(state, "traits.list.items.t0.name", "Natural Armour (2)");
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage").text).toBe("1d10+4");

        updateSignalAtPath(state, "traits.list.items.t0.name", "Natural Weapons (2)");
        deleteItemFromState(state, "traits.list.items.t0");
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage").text).toBe("1d10+4");
        expect(traitLinkOf(state, T1)).toEqual({ id: "t0", name: null, natural: null });
    });
});

describe("the X of a rulebook pick of a Natural Weapons profile", () => {
    it("is the rating of the sheet's trait of the same name", () => {
        const state = sheet(["Natural Weapons (X)", "Deadly Natural Weapons (3)", "Natural Weapons (2)"], "");
        expect(pickedRating(state, "Natural Weapons (X)")).toBe("2");
        expect(pickedRating(state, "Deadly Natural Weapons (X)")).toBe("3");
    });

    it("is X without such a trait", () => {
        const state = sheet(["Deadly Natural Weapons (3)"], "");
        expect(pickedRating(state, "Natural Weapons (X)")).toBe("X");
    });
});
