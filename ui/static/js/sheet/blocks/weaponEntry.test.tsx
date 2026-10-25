import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { conditionOf, loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { Conditions } from "./Conditions";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const E1 = "conditions.list.items.c1.entries.items.e0";
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;

beforeEach(() => {
    loadState({
        conditions: conditionOf({ type: "weapon_bonus", name: "", weaponField: "rngMax", weaponBonus: "1" }),
        meleeAttacks: { list: { items: { m1: { name: "Longsword" } }, layouts: { m1: pos(0, 0) } } },
        rangedAttacks: { list: { items: { r1: { name: "Bolter" } }, layouts: { r1: pos(0, 0) } } },
    });
    attachComputeds(testState());
});

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const entry = () => rendered!.container.querySelector<HTMLElement>('[data-id="e0"]')!;
const name = () => entry().querySelector<HTMLInputElement>('[data-id="name"]')!;
const groups = () => Array.from(entry().querySelectorAll(".autocomplete-group"), el => el.textContent);
const options = (group: string) => {
    const all = Array.from(entry().querySelectorAll(".autocomplete-group, .autocomplete-option"), el => [el.className, el.textContent]);
    const start = all.findIndex(([cls, text]) => cls.includes("group") && text === group);
    const end = all.findIndex(([cls], i) => i > start && cls.includes("group"));
    return all.slice(start + 1, end < 0 ? undefined : end).map(([, text]) => text);
};
const type = (text: string) => act(() => {
    name().value = text;
    name().setSelectionRange(text.length, text.length);
    name().dispatchEvent(new Event("input", { bubbles: true }));
});

describe("a Weapon entry", () => {
    it("has a field of the weapon and a value", () => {
        rendered = renderBlock(<Conditions />);
        const field = entry().querySelector<HTMLSelectElement>('[data-id="weaponField"]')!;
        expect(Array.from(field.options, o => o.textContent)).toEqual(["Rng", "Rng max", "Rng min", "Balance", "Dmg", "Pen"]);
        expect(field.value).toBe("rngMax");
        expect(entry().querySelector<HTMLInputElement>('[data-id="weaponBonus"]')!.value).toBe("1");
    });

    it("suggests the kinds, groups, profiles and the sheet's weapons, and adds a pick after a comma", () => {
        rendered = renderBlock(<Conditions />);
        act(() => name().focus());
        expect(groups()).toEqual(["All", "Groups", "Profiles", "Weapons"]);
        expect(options("All")).toEqual(["Melee", "Ranged"]);
        expect(options("Weapons")).toEqual(["Longsword", "Bolter"]);
        expect(options("Profiles")).toContain("Spear");

        type("sword, bol");
        expect(groups()).toEqual(["Weapons"]);
        act(() => { entry().querySelector(".autocomplete-option")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
        expect(value(`${E1}.name`)).toBe("sword, Bolter");
    });

    it("outlines a word that names nothing, but not one being typed", () => {
        rendered = renderBlock(<Conditions />);
        act(() => updateSignalAtPath(testState(), `${E1}.name`, "sword, Halberd"));
        expect(name().classList.contains("invalid")).toBe(true);
        expect(name().title).toMatch(/^Unknown: halberd\. The entry is off\./);

        act(() => name().focus());
        type("sword, lon");
        expect(name().classList.contains("invalid")).toBe(false);
    });
});
