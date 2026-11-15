import { beforeEach, describe, expect, it } from "vitest";
import { computed, type Signal } from "@preact/signals-core";
import { loadState, testState } from "../components/testUtils";
import { attachComputeds } from "../kinds/computed";
import { createItemInState, resolvePath } from "../core/sync";
import { collectEntries, sumEntryField } from "./entries";

it("fails to count entries of a state without the kind's computeds rather than count none", () => {
    expect(() => collectEntries(loadState({}), "char_bonus")).toThrow(/entry index/);
});

describe("the entries of a type", () => {
    const pos = (rowIndex: number) => ({ colIndex: 0, rowIndex });
    const entries = (...list: object[]) => ({
        items: Object.fromEntries(list.map((e, i) => [`e${i}`, e])),
        layouts: Object.fromEntries(list.map((_, i) => [`e${i}`, pos(i)])),
    });
    const signalAt = (path: string) => resolvePath(testState(), path) as Signal<unknown>;

    let runs = 0;
    let skillBonus: { readonly value: number };

    beforeEach(() => {
        loadState({
            gear: {
                list: {
                    items: { g1: { name: "Boots", equipped: true, entries: entries({ type: "skill_bonus", name: "Acrobatics", skillBonus: "7" }) } },
                    layouts: { g1: pos(0) },
                },
            },
        });
        attachComputeds(testState());
        const state = testState();
        skillBonus = computed(() => {
            runs++;
            return sumEntryField(state, "skill_bonus", "skillBonus");
        });
        expect(skillBonus.value).toBe(7);
        runs = 0;
    });

    it("don't wake their readers when an item that adds none of them is added", () => {
        createItemInState(testState(), "gear.list.items", "g2", {
            name: "Rope", entries: entries({ type: "skill_bonus", name: "Athletics", skillBonus: "3" }),
        }, pos(1));
        createItemInState(testState(), "gear.list.items", "g3", {
            name: "Ring", equipped: true, entries: entries({ type: "initiative_bonus", initiativeBonus: "1" }),
        }, pos(2));
        expect(skillBonus.value).toBe(7);
        expect(runs).toBe(0);
    });

    it("wake their readers when an item with one of them is equipped or one of them changes", () => {
        createItemInState(testState(), "gear.list.items", "g2", {
            name: "Rope", entries: entries({ type: "skill_bonus", name: "Athletics", skillBonus: "3" }),
        }, pos(1));
        signalAt("gear.list.items.g2.equipped").value = true;
        expect(skillBonus.value).toBe(10);
        expect(runs).toBe(1);

        signalAt("gear.list.items.g1.entries.items.e0.skillBonus").value = "9";
        expect(skillBonus.value).toBe(12);
        expect(runs).toBe(2);

        signalAt("gear.list.items.g1.equipped").value = false;
        expect(skillBonus.value).toBe(3);
        expect(runs).toBe(3);
    });
});
