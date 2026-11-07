import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet } from "../components/testUtils";
import { armourComputeds, gearApTotal } from "./armour";
import { attachComputeds } from "./computed";
import { WEAPON_DAMAGE, statAt } from "./damage";
import type { GearItem } from "./materials";
import { meleeAttackBonus, meleeHitLines } from "./melee";
import { parryAt } from "./parry";
import { qualitySpecial, qualityTitle, withoutProperties } from "./quality";
import { resolvePath, updateSignalAtPath } from "./sync";
import { hitLines } from "./weaponBonus";

afterEach(teardownSheet);

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

const M1 = "meleeAttacks.list.items.m1";
const T1 = `${M1}.tabs.items.t1`;
const S1 = "meleeAttacks.list.items.s1";
const R1 = "rangedAttacks.list.items.r1";

/**
 * WS 45 and A 40, Parry trained: a Longsword, a Heater Shield, a Musket and
 * Chainmail (AP 4 on torso and arms, worn) in the gear, each of `quality`,
 * and the attacks linked to the weapons, the musket with `rangedSpecial`.
 */
function sheet({ quality = "Common", rangedSpecial = "", link = true } = {}) {
    const state = loadState({
        characteristics: { WS: { value: "45" }, A: { value: "40" } },
        skillsLeft: { parry: { characteristic: "WS", plus0: true } },
        gear: {
            list: {
                items: {
                    g1: { name: "Longsword", quality, gearType: "weapon" },
                    g2: { name: "Heater Shield", quality, gearType: "weapon" },
                    g3: { name: "Musket", quality, gearType: "weapon" },
                    g4: { name: "Chainmail", quality, gearType: "armour", equipped: true, armour: { ap: { torso: "4", arms: "4", head: "-" } } },
                },
                layouts: { g1: pos(0, 0), g2: pos(0, 1), g3: pos(0, 2), g4: pos(0, 3) },
            },
        },
        meleeAttacks: {
            list: {
                items: {
                    m1: {
                        name: "Longsword", group: "primary", balance: "1", item: link ? "g1" : "",
                        tabs: { items: { t1: { profile: "sword", damage: "1d10+2", pen: "0", special: "Primitive" } }, layouts: { t1: pos(0, 0) } },
                    },
                    s1: {
                        name: "Heater Shield", group: "primary (shield)", balance: "0", item: link ? "g2" : "",
                        shield: { ap: 2, defenseSectors: "A1+T", arm: "left", equipped: true },
                        tabs: { items: { t1: { profile: "shield", damage: "1d5", pen: "0" } }, layouts: { t1: pos(0, 0) } },
                    },
                },
                layouts: { m1: pos(0, 0), s1: pos(0, 1) },
            },
        },
        rangedAttacks: {
            list: {
                items: { r1: { name: "Musket", class: "rifle", damage: "1d10+4", pen: "1", special: rangedSpecial, item: link ? "g3" : "" } },
                layouts: { r1: pos(0, 0) },
            },
        },
    });
    attachComputeds(state);
    return state;
}

const item = (state: ReturnType<typeof sheet>, id: string) => state.gear.list.items[id] as GearItem;
const valueForRolls = (state: ReturnType<typeof sheet>, key: string) =>
    (resolvePath(state, `characteristics.${key}.valueForRolls`) as { value: number }).value;

describe("the Quality of a melee weapon", () => {
    it("adds to its attacks and its Parry as a line named by the Quality and the item", () => {
        const good = sheet({ quality: "Good" });
        expect(meleeHitLines(good, M1, null)).toEqual([{ label: "Good.Q (Longsword) +5", add: 5 }]);
        expect(meleeAttackBonus(good, M1)).toBe(5);
        const common = parryAt(sheet(), M1).value;
        teardownSheet();
        const poor = sheet({ quality: "Poor" });
        expect(meleeAttackBonus(poor, M1)).toBe(-10);
        expect(parryAt(poor, M1).value).toBe(common - 10);
        expect(parryAt(poor, M1).lines).toContainEqual(expect.objectContaining({ label: "Poor.Q (Longsword)" }));
    });

    it("gives +1 Dmg and drops Primitive at Best, Best replacing Good", () => {
        const state = sheet({ quality: "Best" });
        expect(meleeAttackBonus(state, M1)).toBe(10);
        expect(statAt(state, WEAPON_DAMAGE, T1, "damage").expression).toBe("1d10+3");
        expect(qualitySpecial(state, T1)).toEqual({ added: [], removed: ["Primitive"], lines: ["No Primitive: Best.Q of Longsword"] });
    });

    it("gives nothing at Common, nor without a link", () => {
        expect(meleeAttackBonus(sheet(), M1)).toBe(0);
        expect(qualitySpecial(sheet(), T1)).toBeNull();
        teardownSheet();
        const unlinked = sheet({ quality: "Best", link: false });
        expect(meleeAttackBonus(unlinked, M1)).toBe(0);
        expect(statAt(unlinked, WEAPON_DAMAGE, T1, "damage").expression).toBe("1d10+2");
    });
});

describe("the Quality of a shield", () => {
    it("adds to its tests as a melee weapon's, and +1 shield AP instead of Dmg at Best", () => {
        const state = sheet({ quality: "Best" });
        expect(meleeAttackBonus(state, S1)).toBe(10);
        expect(statAt(state, WEAPON_DAMAGE, `${S1}.tabs.items.t1`, "damage").expression).toBe("1d5");
        const parts = armourComputeds(state).parts;
        expect(parts.body.shields.value).toEqual([{ name: "Heater Shield", ap: 3 }]);
        updateSignalAtPath(state, "gear.list.items.g2.quality", "Good");
        expect(parts.body.shields.value).toEqual([{ name: "Heater Shield", ap: 2 }]);
    });
});

describe("the Quality of a ranged weapon", () => {
    it("adds Reliability to the Special, which only names the property it comes to", () => {
        const state = sheet({ quality: "Good" });
        expect(hitLines(state, R1)).toEqual([]);
        expect(qualitySpecial(state, R1)).toEqual({ added: ["Reliable"], removed: [], lines: ["Reliability 0 +1 Good.Q of Musket = +1: Reliable"] });
        updateSignalAtPath(state, `${R1}.special`, "Unreliable, Inaccurate");
        expect(qualitySpecial(state, R1)).toMatchObject({ added: [], removed: ["Unreliable"] });
    });

    it("keeps the sum within −2…+2 and drops Primitive at Best", () => {
        const state = sheet({ quality: "Best", rangedSpecial: "Reliable, Primitive" });
        expect(qualitySpecial(state, R1)).toMatchObject({ added: ["Very Reliable"], removed: ["Reliable", "Primitive"] });
        updateSignalAtPath(state, `${R1}.special`, "Very Reliable");
        expect(qualitySpecial(state, R1)).toBeNull();
        updateSignalAtPath(state, "gear.list.items.g3.quality", "Poor");
        expect(qualitySpecial(state, R1)).toMatchObject({ added: ["Reliable"], removed: ["Very Reliable"] });
        updateSignalAtPath(state, `${R1}.special`, "Very Unreliable");
        expect(qualitySpecial(state, R1)).toBeNull();
    });
});

describe("a Special without the properties the Quality removes", () => {
    it("drops them whatever their case and values in brackets, and keeps the rest in order", () => {
        expect(withoutProperties("Primitive, Tearing (2), reliable", ["Primitive", "Reliable"])).toBe("Tearing (2)");
        expect(withoutProperties("Primitive", ["Primitive"])).toBe("");
        expect(withoutProperties("Balanced; Primitive (x)", ["Primitive"])).toBe("Balanced");
    });
});

describe("the Quality of armour", () => {
    it("adds +1 AP at Best on every location it covers, before Broken halves it", () => {
        const state = sheet({ quality: "Best" });
        expect(gearApTotal(item(state, "g4"), "torso")).toMatchObject({ total: 5, lines: ["4 Chainmail", "+1 Best.Q", "= 5"] });
        expect(gearApTotal(item(state, "g4"), "head")).toBeNull();
        expect(armourComputeds(state).parts.leftArm.gearArmour.value).toBe(5);
        updateSignalAtPath(state, "gear.list.items.g4.quality", "Good");
        expect(gearApTotal(item(state, "g4"), "torso")?.total).toBe(4);
    });

    it("takes 10 off all A tests while worn at Poor", () => {
        const state = sheet({ quality: "Poor" });
        expect(valueForRolls(state, "A")).toBe(30);
        expect(valueForRolls(state, "WS")).toBe(45);
        updateSignalAtPath(state, "gear.list.items.g4.equipped", false);
        expect(valueForRolls(state, "A")).toBe(40);
        updateSignalAtPath(state, "gear.list.items.g4.equipped", true);
        updateSignalAtPath(state, "gear.list.items.g4.quality", "Common");
        expect(valueForRolls(state, "A")).toBe(40);
    });

    it("names what it does by the item's type in the title of its select", () => {
        const state = sheet({ quality: "Good" });
        expect(qualityTitle(item(state, "g4"))).toBe("Quality: Good.Q\nCalled shots at the wearer's joints and eyes −10.");
        expect(qualityTitle(item(state, "g1"))).toContain("Counted in the linked attacks.");
    });
});
