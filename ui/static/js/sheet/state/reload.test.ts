import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet } from "../components/testUtils";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { readReload, reloadAt, reloadText } from "./reload";

afterEach(teardownSheet);

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (...rows: object[]) => ({
    items: Object.fromEntries(rows.map((r, i) => [`e${i}`, r])),
    layouts: Object.fromEntries(rows.map((_, i) => [`e${i}`, pos(0, i)])),
});
const reloadEntry = (name: string, weaponBonus: string) => ({ type: "weapon_bonus", name, weaponField: "reload", weaponBonus });

const R1 = "rangedAttacks.list.items.r1";

/**
 * A Pathfinder Crusade sheet with a ranged attack of Reload `reload` linked
 * to a gear item whose Quick Loading has `item` entries, under a condition
 * Rapid Reload of `condition` entries.
 */
function sheet(reload: string, { item = [] as string[], condition = [] as object[], link = true } = {}) {
    const state = loadState({
        conditions: { list: { items: { c1: { name: "Rapid Reload", enabled: true, stacks: 1, entries: grid(...condition) } }, layouts: { c1: pos(0, 0) } } },
        gear: {
            list: {
                items: {
                    g1: {
                        name: "Arbalest", gearType: "weapon", equipped: false,
                        enchantments: grid({ name: "Quick Loading", entries: grid(...item.map(v => reloadEntry("This item", v))), level: "l0", levels: grid({ capacity: 2 }) }),
                    },
                },
                layouts: { g1: pos(0, 0) },
            },
        },
        rangedAttacks: { list: { items: { r1: { name: "Arbalest", class: "rifle", reload, item: link ? "g1" : "" } }, layouts: { r1: pos(0, 0) } } },
    }, pathfinderCrusade);
    attachComputeds(state);
    return state;
}

const total = (reload: string, opts?: Parameters<typeof sheet>[1]) => reloadAt(sheet(reload, opts), R1, 1).text;

describe("a Reload", () => {
    it("reads half-actions in Pathfinder Crusade, ½ for one, and actions in Black Crusade", () => {
        expect(["½", "2", "4", "0"].map(t => readReload(t, 1))).toEqual([1, 2, 4, 0]);
        expect(["½", "1", "2", "1½"].map(t => readReload(t, 2))).toEqual([1, 2, 4, 3]);
        for (const t of ["", "1 [2]", "2×2", "†", "–", "Нет"]) expect(readReload(t, 2)).toBeNull();
    });

    it("writes the half-actions as the kind's table does, none as Free", () => {
        expect([0, 1, 3].map(h => reloadText(h, 1))).toEqual(["Free", "1", "3"]);
        expect([0, 1, 2, 3, 4].map(h => reloadText(h, 2))).toEqual(["Free", "½", "1", "1½", "2"]);
    });

    it("shows a half-action of the table as 1, and a value of no number as typed, without the entries", () => {
        expect(total("½")).toBe("1");
        const state = sheet("1 [2]", { condition: [reloadEntry("Ranged", "×½")] });
        expect(reloadAt(state, R1, 2)).toMatchObject({ text: "1 [2]", halves: null, lines: [] });
        expect(total("")).toBe("");
    });

    it("counts Quick Loading of the linked item, named by the item, and Rapid Reload of a condition", () => {
        expect(reloadAt(sheet("4", { item: ["-1"], condition: [reloadEntry("Ranged", "×½")] }), R1, 1)).toMatchObject({
            halves: 1,
            text: "1",
            lines: [{ text: "-1", label: "Quick Loading (Arbalest)" }, { text: "×½", label: "Rapid Reload" }],
        });
        expect(total("4", { item: ["-1"], link: false })).toBe("4");
    });

    it("applies the item's entries first, then the other adds, then the other factors", () => {
        // −1 of the item before ×½ of the condition: (5 − 1) × ½ = 2, not ⌊5 × ½⌋ − 1 = 1.
        expect(total("5", { item: ["-1"], condition: [reloadEntry("Ranged", "×½")] })).toBe("2");
        // ×½ of the item before −1 of a condition: ⌊5 × ½⌋ − 1 = 1, not ⌊(5 − 1) × ½⌋ = 2.
        expect(total("5", { item: ["×½"], condition: [reloadEntry("Ranged", "-1")] })).toBe("1");
    });

    it("keeps the item's entries and the adds at a half-action, while a factor of a condition makes it Free", () => {
        expect(total("½", { item: ["-1"] })).toBe("1");
        expect(total("½", { item: ["×½"] })).toBe("1");
        // A siege mage's −PR.
        expect(total("2", { condition: [reloadEntry("Ranged", "-3")] })).toBe("1");
        expect(total("½", { condition: [reloadEntry("Ranged", "×½")] })).toBe("Free");
        expect(total("3", { condition: [reloadEntry("Ranged", "×½")] })).toBe("1");
        // A free action stays free.
        expect(total("0", { item: ["-1"] })).toBe("Free");
    });

    it("lengthens by an entry that adds, as a missing crew member's +2", () => {
        expect(total("2", { condition: [reloadEntry("Arbalest", "2")] })).toBe("4");
    });

    it("halves an action of Black Crusade into a half-action, and a half-action into Free", () => {
        const state = sheet("1", { condition: [reloadEntry("Ranged", "×½")] });
        expect(reloadAt(state, R1, 2).text).toBe("½");
        expect(reloadAt(sheet("½", { condition: [reloadEntry("Ranged", "×½")] }), R1, 2).text).toBe("Free");
    });
});
