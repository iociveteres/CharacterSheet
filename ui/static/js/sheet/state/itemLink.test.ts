import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet } from "../components/testUtils";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { WEAPON_DAMAGE, statAt } from "./damage";
import { addedProperties, brokenNote, linkOf, linkedAttacks } from "./itemLink";
import { balanceAt, meleeRangeAt } from "./melee";
import { rangeAt } from "./range";
import { deleteItemFromState, updateSignalAtPath } from "./sync";

afterEach(teardownSheet);

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (...rows: object[]) => ({
    items: Object.fromEntries(rows.map((r, i) => [`e${i}`, r])),
    layouts: Object.fromEntries(rows.map((_, i) => [`e${i}`, pos(0, i)])),
});
const weaponEntry = (name: string, weaponField: string, weaponBonus: string) => ({ type: "weapon_bonus", name, weaponField, weaponBonus });

/** An enchantment with its chosen level copied to its fields; two levels make its chip "Name capacity". */
const enchantment = (name: string, capacity: number, special = "", entries: object[] = []) => ({
    name, capacity, special, entries: grid(...entries), level: "l1",
    levels: grid({ capacity: 1 }, { capacity }),
});

const M1 = "meleeAttacks.list.items.m1";
const T1 = `${M1}.tabs.items.t1`;
const R1 = "rangedAttacks.list.items.r1";
const R2 = "rangedAttacks.list.items.r2";

const mithral = { name: "Mithral", pen: 1, weightFactor: 0.5, entries: grid() };

/**
 * A Pathfinder Crusade sheet: an equipped mithral Longsword with Flaming 3 and
 * Self-Balancing, a Longbow with Distance left unequipped, equipped Bracers of
 * Hurling; a Longsword attack, a Longbow and a Javelin.
 */
function sheet({ link = true, kind = pathfinderCrusade, gear = {} as object } = {}) {
    const state = loadState({
        characteristics: { S: { value: "40" } },
        gear: {
            list: {
                items: {
                    g1: {
                        name: "Longsword", gearType: "weapon", equipped: true, material: mithral,
                        enchantments: grid(
                            enchantment("Flaming", 3, "Flame (d10)"),
                            enchantment("Self-Balancing", 7, "", [weaponEntry("This item", "balance", "1")]),
                        ),
                    },
                    g2: { name: "Longbow", gearType: "weapon", equipped: false, enchantments: grid(enchantment("Distance", 5, "", [weaponEntry("This item", "rng", "×2")])) },
                    g3: { name: "Bracers", gearType: "gear", equipped: true, enchantments: grid(enchantment("Hurling", 4, "", [weaponEntry("Throwing, Grenade", "rng", "×1.5")])) },
                    ...gear,
                },
                layouts: { g1: pos(0, 0), g2: pos(0, 1), g3: pos(0, 2) },
            },
        },
        meleeAttacks: {
            list: {
                items: {
                    m1: {
                        name: "Longsword", group: "primary", balance: "2", item: link ? "g1" : "",
                        tabs: { items: { t1: { profile: "sword", range: "2-4", damage: "1d10+2", pen: "0", special: "Primitive" } }, layouts: { t1: pos(0, 0) } },
                    },
                },
                layouts: { m1: pos(0, 0) },
            },
        },
        rangedAttacks: {
            list: {
                items: {
                    r1: { name: "Longbow", class: "rifle", range: "100м", damage: "1d10", pen: "0", item: link ? "g2" : "" },
                    r2: { name: "Javelin", class: "throwing", damage: "1d10", pen: "0" },
                },
                layouts: { r1: pos(0, 0), r2: pos(0, 1) },
            },
        },
    }, kind);
    attachComputeds(state);
    return state;
}

describe("an attack linked to a gear item", () => {
    it("gets the Pen of the item's material as a line named by the material and the item", () => {
        const pen = statAt(sheet(), WEAPON_DAMAGE, T1, "pen");
        expect(pen).toMatchObject({ text: "1", parts: ["Mithral (Longsword) +1"], added: [{ text: "+1", label: "Mithral (Longsword)" }] });
        expect(statAt(sheet({ link: false }), WEAPON_DAMAGE, T1, "pen").text).toBe("0");
    });

    it("adds the Special of the item's enchantments, named by the enchantment, but what its own Special has", () => {
        const state = sheet();
        expect(addedProperties(state, T1)).toEqual([{ text: "Flame (d10)", source: "Flaming 3" }]);
        updateSignalAtPath(state, `${T1}.special`, "Primitive, Flame (d10)");
        expect(addedProperties(state, T1)).toEqual([]);
    });

    it("counts the item's This item entries: Self-Balancing on Balance 2 stops at the limit", () => {
        expect(balanceAt(sheet(), M1)).toMatchObject({
            value: 2, text: "2", lines: [{ text: "+1", label: "Self-Balancing (Longsword)" }, { text: "≤ 2", label: "Balance limit" }],
        });
        expect(balanceAt(sheet({ link: false }), M1).lines).toEqual([]);
    });

    it("counts a This item entry on Rng max of the item's own entries, named by the item", () => {
        const state = sheet({
            gear: { g1: { name: "Longsword", gearType: "weapon", equipped: true, entries: grid(weaponEntry("This item", "rngMax", "2")) } },
        });
        expect(meleeRangeAt(state, T1)).toMatchObject({ text: "2-6", lines: [{ text: "+2 max", label: "Longsword" }] });
    });

    it("multiplies the range of a ranged attack by Distance ×2 of its item, equipped or not", () => {
        expect(rangeAt(sheet(), R1)).toMatchObject({ text: "200м", mods: [{ expr: "Distance (Longbow)", factor: 2 }] });
        expect(rangeAt(sheet({ link: false }), R1).text).toBe("100м");
    });

    it("leaves the factor of a melee range off, with a line that says so", () => {
        const state = sheet({
            gear: { g1: { name: "Longsword", gearType: "weapon", equipped: true, entries: grid(weaponEntry("This item", "rng", "×2")) } },
        });
        expect(meleeRangeAt(state, T1)).toMatchObject({ text: "2-4", lines: [{ text: "×2", label: "Longsword: ranged only" }] });
    });

    it("notes on the damage that a broken item halves it after armour", () => {
        const state = sheet();
        expect(brokenNote(state, T1)).toBe("");
        updateSignalAtPath(state, "gear.list.items.g1.broken", true);
        expect(brokenNote(state, T1)).toBe("½ after armour: Longsword is broken");
        // The dice stay as rolled.
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage").text).toBe("1d10+2");
    });

    it("keeps the link to a deleted item, which gives nothing", () => {
        const state = sheet();
        deleteItemFromState(state, "gear.list.items.g1");
        expect(linkOf(state, T1)).toEqual({ id: "g1", item: null });
        expect(statAt(state, WEAPON_DAMAGE, T1, "pen").text).toBe("0");
        expect(balanceAt(state, M1).lines).toEqual([]);
        expect(addedProperties(state, T1)).toEqual([]);
    });

    it("lists the attacks of an item", () => {
        expect(linkedAttacks(sheet(), "g1")).toEqual([{ path: M1, block: "meleeAttacks.list.items", name: "Longsword" }]);
        expect(linkedAttacks(sheet({ link: false }), "g1")).toEqual([]);
    });
});

describe("weapon entries of gear items", () => {
    it("multiply the range of thrown weapons by Hurling of equipped bracers, not of others", () => {
        const state = sheet();
        // S.b×3 by the rules of thrown weapons, ×1.5 rounded down.
        expect(rangeAt(state, R2)).toMatchObject({ text: "18м", mods: [{ expr: "Hurling", factor: 1.5, roundUp: false }] });
        expect(rangeAt(state, R1).mods.map(m => m.expr)).toEqual(["Distance (Longbow)"]);
        updateSignalAtPath(state, "gear.list.items.g3.equipped", false);
        expect(rangeAt(state, R2).text).toBe("12м");
    });

    it("count a This item entry once, through the link, though the item is equipped", () => {
        // Self-Balancing is in the entries of the equipped Longsword too.
        expect(balanceAt(sheet(), M1).lines.filter(l => l.label.startsWith("Self-Balancing"))).toHaveLength(1);
        // An attack of another item gets nothing from it.
        const state = sheet();
        updateSignalAtPath(state, `${M1}.item`, "g2");
        expect(balanceAt(state, M1).lines).toEqual([]);
    });

    it("turn a This item entry of a condition off: it names no item", () => {
        const state = loadState({
            conditions: { list: { items: { c1: { name: "Blessed", enabled: true, stacks: 1, entries: grid(weaponEntry("This item", "balance", "1")) } }, layouts: { c1: pos(0, 0) } } },
            meleeAttacks: { list: { items: { m1: { name: "Sword", balance: "0", tabs: { items: {}, layouts: {} } } }, layouts: { m1: pos(0, 0) } } },
        }, pathfinderCrusade);
        attachComputeds(state);
        expect(balanceAt(state, M1).lines).toEqual([]);
    });
});

describe("a Black Crusade sheet", () => {
    it("links attacks to gear items, whose This item entries count, without materials or Broken", () => {
        const state = loadState({
            gear: {
                list: {
                    items: { g1: { name: "Chainsword", gearType: "weapon", entries: grid(weaponEntry("This item", "pen", "2")), material: mithral, broken: true } },
                    layouts: { g1: pos(0, 0) },
                },
            },
            meleeAttacks: {
                list: {
                    items: { m1: { name: "Chainsword", item: "g1", tabs: { items: { t1: { profile: "sword", damage: "1d10", pen: "2" } }, layouts: { t1: pos(0, 0) } } } },
                    layouts: { m1: pos(0, 0) },
                },
            },
        });
        attachComputeds(state);
        // The kind has no material or Broken: the content's are dropped.
        expect(statAt(state, WEAPON_DAMAGE, T1, "pen")).toMatchObject({ text: "4", parts: ["Chainsword +2"] });
        expect(brokenNote(state, T1)).toBe("");
        expect(linkedAttacks(state, "g1")).toHaveLength(1);
    });
});
