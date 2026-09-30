import { describe, expect, it } from "vitest";
import { groupLabel, groupValue, initiativeView, leaderOf, sortGroups, type Contender, type OrderGroup } from "./order";

let nextId = 1;
const c = (value: number | null, agilityBonus = 3, agility = 30): Contender =>
    ({ participantId: nextId++, value, agilityBonus, agility });
const g = (id: number, ...members: Contender[]): OrderGroup => ({ id, members });

describe("the turn order", () => {
    it("goes by value, those who have not rolled last", () => {
        expect(sortGroups([g(1, c(null)), g(2, c(12)), g(3, c(18)), g(4, c(15))])).toEqual([3, 4, 2, 1]);
    });

    it("breaks a tie by AgB, then by Ag, then by the order groups were added", () => {
        expect(sortGroups([g(1, c(12, 3, 35)), g(2, c(12, 4, 40)), g(3, c(12, 3, 38))])).toEqual([2, 3, 1]);
        expect(sortGroups([g(2, c(12, 3, 30)), g(1, c(12, 3, 30))])).toEqual([1, 2]);
    });

    it("breaks the tie of those who have not rolled by the one who rolls for them", () => {
        expect(sortGroups([g(1, c(null, 2)), g(2, c(null, 4)), g(3, c(null, 3))])).toEqual([2, 3, 1]);
    });

    it("takes a value the gamemaster typed as any other: it is the sheet's", () => {
        expect(sortGroups([g(1, c(14)), g(2, c(20))])).toEqual([2, 1]);
    });
});

describe("a group", () => {
    it("takes the best value of those who rolled", () => {
        const best = c(15, 2);
        const group = g(1, c(9, 5), best, c(null, 6));
        expect(leaderOf(group.members)).toBe(best);
        expect(groupValue(group)).toBe(15);
    });

    it("of equal rolls takes the one with the better agility, whose AgB breaks its ties", () => {
        const quick = c(15, 4, 45);
        expect(leaderOf([c(15, 4, 40), quick, c(15, 3, 50)])).toBe(quick);
        expect(sortGroups([g(1, c(15, 4, 44)), g(2, c(15, 3, 50), quick)])).toEqual([2, 1]);
    });

    it("with a mount takes the player's roll: the mount does not roll", () => {
        const player = c(17, 3);
        const mount = c(null, 5);
        expect(leaderOf([mount, player])).toBe(player);
        expect(groupValue(g(1, mount, player))).toBe(17);
    });

    it("none of whom rolled has no value and is rolled for by the one with the best AgB", () => {
        const quick = c(null, 5);
        const group = g(1, c(null, 3), quick);
        expect(groupValue(group)).toBeNull();
        expect(leaderOf(group.members)).toBe(quick);
    });

    it("goes by its name, or by the names of its members", () => {
        expect(groupLabel("Orcs", ["Orc 1", "Orc 2"])).toBe("Orcs");
        expect(groupLabel(null, ["Sister Mira", "Castor"])).toBe("Sister Mira, Castor");
        expect(groupLabel(" ", ["Ulrich"])).toBe("Ulrich");
    });
});

describe("the view of the players", () => {
    it("has the rows in turn order and the current one marked", () => {
        const rows = [
            { groupId: 3, label: "Ulrich", value: 18 },
            { groupId: 1, label: "Figure in the shadows", value: 12 },
            { groupId: 2, label: "Servitor", value: null },
        ];
        expect(initiativeView(2, 1, rows)).toEqual({
            round: 2,
            current: 1,
            rows: [{ name: "Ulrich", value: 18 }, { name: "Figure in the shadows", value: 12 }, { name: "Servitor", value: null }],
        });
        expect(initiativeView(1, null, rows).current).toBeNull();
    });
});
