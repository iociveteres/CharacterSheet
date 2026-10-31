import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet, testState } from "../components/testUtils";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { characteristicCaps, itemCap } from "./caps";
import { characteristicSummary } from "./characteristicSummary";
import { attachComputeds } from "./computed";
import { conditionSummary, entrySummary } from "./conditionSummary";
import type { GearItem } from "./materials";
import { resolvePath, updateSignalAtPath } from "./sync";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

const grid = (items: object[], prefix = "e") => ({
    items: Object.fromEntries(items.map((e, i) => [`${prefix}${i}`, e])),
    layouts: Object.fromEntries(items.map((_, i) => [`${prefix}${i}`, pos(0, i)])),
});

const capA = (cap: string) => ({ type: "char_cap", name: "A", cap });
const capBonusA = (capBonus: string) => ({ type: "char_cap_bonus", name: "A", capBonus });

const mithral = { name: "Mithral", weightFactor: 0.5, capacityFactor: 1, durability: 2, ap: 1, short: "+20 Max.A", entries: grid([capBonusA("20")]) };
const agile = { name: "Agile", capacity: 3, entries: grid([capBonusA("10")]) };

/** A worn Mail Hauberk (Max.A 35) of Mithral with Agile 3. */
const hauberk = (item: object = {}) => ({
    name: "Mail Hauberk", gearType: "armour", carried: true, equipped: true,
    entries: grid([capA("35")]),
    material: mithral,
    enchantments: grid([agile], "n"),
    ...item,
});

/** A worn Plate Cuirass, Max.A 50. */
const cuirass = (item: object = {}) => ({
    name: "Plate Cuirass", gearType: "armour", carried: true, equipped: true, entries: grid([capA("50")]), ...item,
});

function load(items: object[], extra: object = {}) {
    loadState({
        characteristics: { A: { value: "90" } },
        gear: { list: grid(items, "g") },
        ...extra,
    }, pathfinderCrusade);
    attachComputeds(testState());
}

const agility = () => testState().characteristics.A.calculatedValue.value;
const totals = () => characteristicCaps(testState(), "A").map(c => [String(c.ref.source.name.value), c.total]);
const item = (id: string) => resolvePath(testState(), `gear.list.items.${id}`) as GearItem;

afterEach(teardownSheet);

describe("a Cap Bonus", () => {
    it("of a gear item's material and enchantment raises only that item's caps", () => {
        load([hauberk(), cuirass()]);
        expect(totals()).toEqual([["Mail Hauberk", 65], ["Plate Cuirass", 50]]);
    });

    it("of a condition or an implant raises every cap", () => {
        load([hauberk(), cuirass()], {
            conditions: { list: grid([{ name: "Armour Training", enabled: true, stacks: 2, entries: grid([capBonusA("5X")]) }], "c") },
            cybernetics: { list: grid([{ name: "Servo Joints", entries: grid([capBonusA("3")]) }], "i") },
        });
        expect(totals()).toEqual([["Mail Hauberk", 78], ["Plate Cuirass", 63]]);
        expect(agility()).toBe(63);
    });

    it("leaves the lowest raised cap to count", () => {
        load([hauberk(), cuirass()]);
        expect(agility()).toBe(50);
        updateSignalAtPath(testState(), "gear.list.items.g1.equipped", false);
        expect(agility()).toBe(65);
    });

    it("of an item without a cap raises no other item's", () => {
        load([hauberk({ entries: grid([]) }), cuirass()]);
        expect(totals()).toEqual([["Plate Cuirass", 50]]);
    });

    it("comes with the material's other entries, which count only while the item is worn", () => {
        const heavy = { ...mithral, entries: grid([capBonusA("20"), { type: "char_bonus", name: "A", bonus: "-30" }]) };
        load([hauberk({ material: heavy })]);
        expect(agility()).toBe(60);
        updateSignalAtPath(testState(), "gear.list.items.g0.equipped", false);
        expect(agility()).toBe(90);
        expect(totals()).toEqual([]);
    });

    it("of a material counts while the material is named", () => {
        load([hauberk({ enchantments: grid([]) })]);
        expect(agility()).toBe(55);
        updateSignalAtPath(testState(), "gear.list.items.g0.material.name", "");
        expect(agility()).toBe(35);
    });

    it("raises the cap of an item put away as it would be worn", () => {
        load([hauberk({ equipped: false })], {
            conditions: { list: grid([{ name: "Armour Training", enabled: true, stacks: 1, entries: grid([capBonusA("5")]) }], "c") },
        });
        expect(agility()).toBe(90);
        expect(itemCap(testState(), item("g0"), "A")?.total).toBe(70);
        expect(itemCap(testState(), item("g0"), "S")).toBeNull();
    });
});

describe("the summaries of caps", () => {
    it("name each cap with its raises in the characteristic's title", () => {
        load([hauberk(), cuirass()], {
            conditions: { list: grid([{ name: "Armour Training", enabled: true, stacks: 1, entries: grid([capBonusA("5")]) }], "c") },
        });
        expect(characteristicSummary(testState(), "A")).toEqual([
            "A 55",
            "Permanent 90",
            "Mail Hauberk: at most 70 (35 +20 Mithral +10 Agile +5 Armour Training)",
            "Plate Cuirass: at most 55 (50 +5 Armour Training)",
        ]);
    });

    it("describe a Cap Bonus with its stacks", () => {
        load([], {
            conditions: { list: grid([{ name: "Armour Training", enabled: true, stacks: 2, entries: grid([capBonusA("5X"), capA("40")]) }], "c") },
        });
        expect(conditionSummary(testState(), "c0")).toEqual(["A caps +10", "A at most 40"]);
        const entry = testState().conditions.list.items.c0.entries.items.e0;
        updateSignalAtPath(testState(), "conditions.list.items.c0.entries.items.e0.capBonus", "0");
        expect(entrySummary(entry, 1)).toBeNull();
    });
});
