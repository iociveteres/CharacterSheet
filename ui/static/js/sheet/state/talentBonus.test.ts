import { afterEach, describe, expect, it } from "vitest";
import { loadState, teardownSheet } from "../components/testUtils";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "./computed";
import { WEAPON_DAMAGE, statAt } from "./damage";
import { rangeAt } from "./range";

afterEach(teardownSheet);

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const T1 = "meleeAttacks.list.items.m1.tabs.items.t1";
const ranged = (id: string) => `rangedAttacks.list.items.${id}`;

const RANGED = {
    bolter: { name: "Bolter", class: "rifle", range: "100м", damage: "1d10+5" },
    javelin: { name: "Javelin", class: "throwing", range: "S.b×5м", damage: "1d10+S.b", special: "Piercing, Primitive" },
    bow: { name: "Bow", class: "special", range: "S.b×10м", damage: "1d10–3+S.b", special: "Draw (2-3), Piercing, Primitive, Reliable" },
    frag: { name: "Frag Grenade", class: "grenade", damage: "2d10", special: "Blast (3), Tearing" },
};

/**
 * WS.b 4, BS.b 3, S.b 4, A.b 3; a Longsword and the ranged attacks of
 * RANGED, with `talents` on the talents list.
 */
function sheet(...talents: string[]) {
    const state = loadState({
        characteristics: { WS: { value: "45" }, BS: { value: "35" }, S: { value: "40" }, A: { value: "35" } },
        talents: {
            list: {
                items: Object.fromEntries(talents.map((name, i) => [`t${i}`, { name }])),
                layouts: Object.fromEntries(talents.map((_, i) => [`t${i}`, pos(0, i)])),
            },
        },
        meleeAttacks: {
            list: {
                items: { m1: { name: "Longsword", group: "primary", tabs: { items: { t1: { profile: "sword", damage: "1d10+2" } }, layouts: { t1: pos(0, 0) } } } },
                layouts: { m1: pos(0, 0) },
            },
        },
        rangedAttacks: {
            list: {
                items: RANGED,
                layouts: Object.fromEntries(Object.keys(RANGED).map((id, i) => [id, pos(0, i)])),
            },
        },
    }, pathfinderCrusade);
    attachComputeds(state);
    return state;
}

const damage = (state: ReturnType<typeof sheet>, path: string) => statAt(state, WEAPON_DAMAGE, path, "damage");

describe("a talent of the talents list", () => {
    it("adds nothing while the list does not have it", () => {
        const state = sheet("Rapid Reload");
        expect(damage(state, T1).text).toBe("1d10+2");
        expect(damage(state, ranged("javelin")).text).toBe("1d10+4");
        expect(rangeAt(state, ranged("bow")).text).toBe("40м");
    });

    it("Crushing Blow adds ½WS.b▲ to the damage of melee profiles, not to ranged attacks nor to penetration", () => {
        const state = sheet("Crushing Blow");
        expect(damage(state, T1)).toMatchObject({ text: "1d10+4", parts: ["Crushing Blow +2"] });
        expect(statAt(state, WEAPON_DAMAGE, T1, "pen").parts).toEqual([]);
        expect(damage(state, ranged("bolter")).text).toBe("1d10+5");
    });

    it("Mighty Shot adds ½BS.b▲ to the damage of every ranged attack, by its Russian name too", () => {
        const state = sheet("Могучий Выстрел");
        expect(damage(state, ranged("bolter"))).toMatchObject({ text: "1d10+7", parts: ["Могучий Выстрел +2"] });
        expect(damage(state, ranged("frag")).text).toBe("2d10+2");
        expect(damage(state, T1).text).toBe("1d10+2");
    });

    it("Balearic counts S.b ½A.b▲ higher in the range and damage of thrown and Primitive weapons", () => {
        const state = sheet("Balearic");
        expect(damage(state, ranged("javelin"))).toMatchObject({ text: "1d10+6", parts: ["Balearic +2"] });
        expect(rangeAt(state, ranged("javelin"))).toMatchObject({ text: "30м", mods: [{ expr: "Balearic", add: 10 }] });
        // A bow is of no thrown class, but Primitive: S.b×10м takes ten times as much.
        expect(damage(state, ranged("bow")).text).toBe("1d10+3");
        expect(rangeAt(state, ranged("bow")).text).toBe("60м");
        // A grenade throws farther; its damage has no S.b.
        expect(rangeAt(state, ranged("frag")).text).toBe("18м");
        expect(damage(state, ranged("frag")).parts).toEqual([]);
        expect(damage(state, ranged("bolter")).text).toBe("1d10+5");
        expect(rangeAt(state, ranged("bolter")).text).toBe("100м");
    });

    it("Balearic adds nothing to a thrown weapon with no S.b", () => {
        const state = sheet("Balearic");
        state.rangedAttacks.list.items.bolter.class.value = "throwing";
        expect(damage(state, ranged("bolter")).parts).toEqual([]);
        expect(rangeAt(state, ranged("bolter")).mods).toEqual([]);
    });
});
