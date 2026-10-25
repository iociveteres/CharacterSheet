import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet } from "../components/testUtils";
import { updateSignalAtPath } from "./sync";
import { armourComputeds } from "./armour";
import { attachComputeds, sumEntryField } from "./computed";
import { getRollValue } from "./rollBase";
import { meleeRollName, stanceOf, stanceUnavailable } from "./stances";

afterEach(teardownSheet);

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const A = "meleeAttacks.list.items.m1";

/** WS 45, S 40, A 30, Dodge and Parry trained; the melee attacks `items` in the stance `stance`. */
function sheet(stance: string, items: { [id: string]: object } = {}) {
    const state = loadState({
        characteristics: { WS: { value: "45" }, S: { value: "40" }, A: { value: "30" } },
        skillsLeft: { dodge: { plus0: true }, parry: { plus0: true } },
        meleeAttacks: {
            stance,
            list: { items, layouts: Object.fromEntries(Object.keys(items).map((id, i) => [id, pos(0, i)])) },
        },
    });
    attachComputeds(state);
    return state;
}

const weapon = (profile: string, attack: object = {}) => ({
    name: "Weapon", ...attack, tabs: { items: { t1: { profile } }, layouts: { t1: pos(0, 0) } },
});

describe("the stance of the sheet", () => {
    it("is Standard for none or one the sheet does not know", () => {
        expect(stanceOf(sheet("")).key).toBe("standard");
        expect(stanceOf(sheet("lazy")).key).toBe("standard");
        expect(stanceOf(sheet("palisade")).key).toBe("palisade");
    });

    it("adds its entries as a condition does: Aggressive WS +10", () => {
        const state = sheet("aggressive");
        expect(state.characteristics.WS.valueForRolls.value).toBe(55);
        expect(getRollValue(state, "parry")).toBe(55);
        updateSignalAtPath(state, "meleeAttacks.stance", "");
        expect(state.characteristics.WS.valueForRolls.value).toBe(45);
    });

    it("adds Springy's: SPD −2, Dodge +10, Parry and S −10", () => {
        const state = sheet("springy");
        expect(sumEntryField(state, "movement_bonus", "movementBonus")).toBe(-2);
        expect(getRollValue(state, "dodge")).toBe(40);
        expect(getRollValue(state, "parry")).toBe(35);
        expect(state.characteristics.S.valueForRolls.value).toBe(30);
        expect(state.characteristics.WS.valueForRolls.value).toBe(45);
    });

    it("adds nothing in Standard, Defensive, Covering and Palisade", () => {
        for (const stance of ["", "defensive", "covering", "palisade"]) {
            const state = sheet(stance);
            expect(state.characteristics.WS.valueForRolls.value).toBe(45);
            expect(sumEntryField(state, "movement_bonus", "movementBonus")).toBe(0);
        }
    });
});

describe("what a stance needs", () => {
    it("Springy: a melee weapon of Balance 0 or more, its grip counted", () => {
        expect(stanceUnavailable(sheet(""), "springy")).toBe("No melee weapon of Balance 0 or more, its grip counted");
        expect(stanceUnavailable(sheet("", { m1: weapon("sword", { balance: "-1" }) }), "springy")).not.toBeNull();
        expect(stanceUnavailable(sheet("", { m1: weapon("sword", { balance: "-1" }), m2: weapon("knife") }), "springy")).toBeNull();
        expect(stanceUnavailable(sheet("", { m1: weapon("sword", { balance: "1", grip: "2р [Бл]", gripSelected: "Cl" }) }), "springy")).not.toBeNull();
    });

    it("Palisade: a glaive, spear or bayonet profile", () => {
        expect(stanceUnavailable(sheet("", { m1: weapon("sword") }), "palisade")).toBe("No glaive, spear or bayonet among the melee attacks");
        expect(stanceUnavailable(sheet("", { m1: weapon("sword"), m2: weapon("bayonet") }), "palisade")).toBeNull();
    });

    it("nothing for the others", () => {
        for (const key of ["standard", "aggressive", "defensive", "covering"] as const) expect(stanceUnavailable(sheet(""), key)).toBeNull();
    });
});

describe("a melee roll's name", () => {
    it("names the grip held when not the primary and the stance when not Standard", () => {
        const items = { m1: weapon("sword", { grip: "2р [1р]", gripSelected: "1h" }) };
        expect(meleeRollName(sheet("aggressive", items), A, "Longsword")).toBe("Longsword (1h, Aggressive)");
        expect(meleeRollName(sheet("", items), A, "Longsword")).toBe("Longsword (1h)");
        expect(meleeRollName(sheet("covering", { m1: weapon("sword", { grip: "2р [1р]" }) }), A, "Longsword")).toBe("Longsword (Covering)");
        expect(meleeRollName(sheet("", { m1: weapon("sword") }), A, "Longsword")).toBe("Longsword");
    });
});

describe("the zones of a shield in brackets", () => {
    it("cover only in the Defensive stance", () => {
        const shield = { name: "Heater Shield", group: "primary (shield)", shield: { ap: 4, defenseSectors: "A1+T+(H)", arm: "left", equipped: true } };
        const head = (stance: string) => armourComputeds(sheet(stance, { m1: shield })).parts.head.shields.value;
        expect(head("")).toEqual([]);
        expect(head("defensive")).toEqual([{ name: "Heater Shield", ap: 4 }]);
        expect(armourComputeds(sheet("", { m1: shield })).parts.body.shields.value).toEqual([{ name: "Heater Shield", ap: 4 }]);
    });
});
