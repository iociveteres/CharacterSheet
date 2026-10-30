import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import {
    applyRemote, getDataPath, loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock,
    teardownSheet, testState, type Rendered,
} from "../components/testUtils";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { CarryWeight, Gear } from "./Gear";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;
const G1 = "gear.list.items.g1";
const ENCH = `${G1}.enchantments.items`;
const noEntries = { items: {}, layouts: {} };
const entriesOf = (...entries: object[]) => ({
    items: Object.fromEntries(entries.map((e, i) => [`c${i}`, e])),
    layouts: Object.fromEntries(entries.map((_, i) => [`c${i}`, pos(0, i)])),
});

interface Level { capacity: number; text: string; special?: string; weightFactor?: number; entries?: object }

/** An enchantment as the server gives it (internal/gamedata Enchantment.ClientJSON), level `chosen` copied to its fields. */
function enchantment(name: string, levels: Level[], chosen = 0) {
    const ids = levels.map((_, i) => `lvl-${i}`);
    const full = levels.map(l => ({ special: "", weightFactor: 1, entries: noEntries, ...l }));
    const c = full[chosen];
    return {
        name,
        levels: {
            items: Object.fromEntries(full.map((l, i) => [ids[i], l])),
            layouts: Object.fromEntries(ids.map((id, i) => [id, pos(0, i)])),
        },
        level: ids[chosen],
        capacity: c.capacity, weightFactor: c.weightFactor, description: c.text, special: c.special, entries: c.entries,
    };
}

const flaming = (chosen = 0) => enchantment("Flaming", [
    { capacity: 1, text: "Оружие получает свойство Flame (d5).", special: "Flame (d5)" },
    { capacity: 3, text: "Оружие получает свойство Flame (d10).", special: "Flame (d10)" },
    { capacity: 7, text: "Оружие получает свойство Flame (2d10).", special: "Flame (2d10)", entries: entriesOf({ type: "char_bonus", name: "WS", bonus: "5" }) },
    { capacity: 12, text: "Оружие получает свойство Flame (2d10), тест A–20.", special: "Flame (2d10)" },
], chosen);
const selfBalancing = () => enchantment("Self-Balancing", [
    { capacity: 7, text: "+1 баланса.", entries: entriesOf({ type: "weapon_bonus", name: "This item", weaponField: "balance", weaponBonus: "1" }) },
]);
const feather = (chosen: number) => enchantment("Feather", [
    { capacity: 2, text: "½", weightFactor: 0.5 },
    { capacity: 4, text: "¼", weightFactor: 0.25 },
    { capacity: 11, text: "0", weightFactor: 0 },
], chosen);

const grid = (...items: object[]) => ({
    items: Object.fromEntries(items.map((e, i) => [`e${i + 1}`, e])),
    layouts: Object.fromEntries(items.map((_, i) => [`e${i + 1}`, pos(0, i)])),
});

/** A sheet with the gear item `item`, equipped, and WS 30. */
const withItem = (item: object) => ({
    characteristics: { WS: { value: "30" } },
    gear: { list: { items: { g1: { carried: true, equipped: true, ...item } }, layouts: { g1: pos(0, 0) } } },
    carryWeightAndEncumbrance: { carryWeightBase: 8 },
});

/** A mithral longsword of 3 kg with a ruby (capacity 12), Flaming 3 and Self-Balancing. */
const longsword = (enchantments: object[] = [flaming(1), selfBalancing()]) => withItem({
    name: "Longsword", weight: 3, gearType: "weapon", inlay: "Ruby",
    material: { name: "Mithral", weightFactor: 0.5, capacityFactor: 1 },
    enchantments: grid(...enchantments),
});

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const enchChips = () => Array.from(rendered!.container.querySelectorAll<HTMLElement>(".ench-mods .mod-chip"));
const chipTexts = () => enchChips().map(c => c.querySelector(".mod-chip-name")!.textContent);
const openChip = (text: string) =>
    act(() => enchChips().find(c => c.querySelector(".mod-chip-name")!.textContent === text)!.querySelector<HTMLButtonElement>(".mod-chip-name")!.click());
const levelChips = () => Array.from(rendered!.container.querySelectorAll<HTMLButtonElement>(".ench-mods .level-chip"));
const chooseLevel = (capacity: string) => act(() => levelChips().find(b => b.textContent === capacity)!.click());
const press = (input: HTMLInputElement, key: string) =>
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const type = (input: HTMLInputElement, text: string) =>
    act(() => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });

describe("the enchantments of a gear item", () => {
    it("are picked with all their levels, the first one chosen", () => {
        loadState(longsword([]), pathfinderCrusade);
        const actions = recordingActions();
        const autocomplete = recordingAutocomplete();
        rendered = renderBlock(<Gear />, { actions, autocomplete });

        expect($(".ench-mods .mods-label").textContent).toBe("Ench. 0/12:");
        act(() => $<HTMLButtonElement>(".ench-mods .add-mod").click());
        expect($(".ench-mods .mod-add input").placeholder).toBe("Add enchantment…");
        pickSuggestion(autocomplete, $(".ench-mods .mod-add input"), { name: "Flaming", entryType: "Оружие" });
        const created = actions.sent.find(m => (m as { type: string }).type === "createItem") as { path: string; itemId: string };
        expect(created.path).toBe(ENCH);
        expect(created.itemId).toMatch(/^ench-/);
        const path = `${ENCH}.${created.itemId}`;
        expect(actions.sent.at(-1)).toMatchObject({ type: "autocompleteApply", path, collection: "enchantments", name: "Flaming" });

        act(() => applyRemote({ type: "autocompleteApplied", path, changes: { ...flaming(), entryType: "Оружие" } }));
        expect(chipTexts()).toEqual(["Flaming 1"]);
        expect(levelChips().map(b => b.textContent)).toEqual(["1", "3", "7", "12"]);
        expect(levelChips().map(b => b.classList.contains("selected"))).toEqual([true, false, false, false]);
        expect(levelChips()[1].title).toBe("Оружие получает свойство Flame (d10).");
        expect($(".ench-mods .cap-block").textContent).toBe("Cap.13712");
        expect($<HTMLTextAreaElement>('.ench-mods [data-id="description"]').value).toBe("Оружие получает свойство Flame (d5).");
        const special = $('.ench-special [data-id="special"]');
        expect(special.value).toBe("Flame (d5)");
        expect(getDataPath(special)).toBe(`${path}.special`);
        expect($(".ench-mods .mods-label").textContent).toBe("Ench. 1/12:");
    });

    it("replaces description, special and entries from a chosen level", () => {
        loadState(longsword(), pathfinderCrusade);
        const actions = recordingActions();
        rendered = renderBlock(<Gear />, { actions });

        expect(chipTexts()).toEqual(["Flaming 3", "Self-Balancing"]);
        openChip("Flaming 3");
        expect(levelChips().find(b => b.classList.contains("selected"))!.textContent).toBe("3");
        expect($(".ench-mods .mod-details .add-first-condition")).not.toBeNull();

        chooseLevel("7");
        expect(actions.scheduled.at(-1)![0]).toMatchObject({
            type: "batch", path: `${ENCH}.e1`,
            changes: {
                level: "lvl-2", capacity: 7, weightFactor: 1, special: "Flame (2d10)",
                description: "Оружие получает свойство Flame (2d10).",
                entries: { items: { c0: { type: "char_bonus", name: "WS", bonus: "5" } }, layouts: { c0: pos(0, 0) } },
            },
        });
        expect(chipTexts()).toEqual(["Flaming 7", "Self-Balancing"]);
        expect(levelChips().find(b => b.classList.contains("selected"))!.textContent).toBe("7");
        expect($<HTMLTextAreaElement>('.ench-mods [data-id="description"]').value).toBe("Оружие получает свойство Flame (2d10).");
        expect($('.ench-special [data-id="special"]').value).toBe("Flame (2d10)");
        // The entries are the enchantment's own grid, without the item's fieldset.
        expect(getDataPath($('.ench-mods .mod-details [data-id="bonus"]'))).toBe(`${ENCH}.e1.entries.items.c0.bonus`);
        expect($(".ench-mods .gear-condition-fields")).toBeNull();
        // The level keeps its own entries: choosing another clears the enchantment's.
        chooseLevel("1");
        expect($(".ench-mods .mod-details .add-first-condition")).not.toBeNull();
        expect(value(`${ENCH}.e1.levels.items.lvl-2.entries.items.c0.bonus`)).toBe("5");
    });

    it("keeps an edited Special until another level is chosen", () => {
        loadState(longsword(), pathfinderCrusade);
        rendered = renderBlock(<Gear />);
        openChip("Flaming 3");

        type($('.ench-special [data-id="special"]'), "Flame (d10), Blinding");
        expect(value(`${ENCH}.e1.special`)).toBe("Flame (d10), Blinding");
        openChip("Flaming 3");
        openChip("Flaming 3");
        expect($('.ench-special [data-id="special"]').value).toBe("Flame (d10), Blinding");
        // The level's own text stays as the collection gave it.
        expect(value(`${ENCH}.e1.levels.items.lvl-1.special`)).toBe("Flame (d10)");

        chooseLevel("3");
        expect($('.ench-special [data-id="special"]').value).toBe("Flame (d10)");
    });

    it("counts the capacity taken against the item's, red above it", () => {
        loadState(longsword(), pathfinderCrusade);
        rendered = renderBlock(<Gear />);

        const cap = () => $<HTMLElement>(".ench-cap");
        expect($(".ench-mods .mods-label").textContent).toBe("Ench. 10/12:");
        expect(cap().classList.contains("over")).toBe(false);
        expect(cap().title).toBe(["Capacity for enchantments:", "8 base", "× 1 Mithral", "+ 4 Ruby", "= 12"].join("\n"));

        openChip("Flaming 3");
        chooseLevel("12");
        expect(cap().textContent).toBe("19/12");
        expect(cap().classList.contains("over")).toBe(true);
        expect(cap().title.split("\n").at(-1)).toBe("The enchantments take more");
        // Warned, not forbidden: another can still be added.
        expect($(".ench-mods .add-mod")).not.toBeNull();

        act(() => updateSignalAtPath(testState(), `${G1}.inlay`, "Diamond"));
        expect(cap().textContent).toBe("19/16");
    });

    it("adds an own enchantment of a typed name, with its capacity typed", () => {
        loadState(longsword([]), pathfinderCrusade);
        const actions = recordingActions();
        rendered = renderBlock(<Gear />, { actions });

        act(() => $<HTMLButtonElement>(".ench-mods .add-mod").click());
        const input = $(".ench-mods .mod-add input");
        input.value = "Glowing";
        press(input, "Enter");
        const created = actions.sent.find(m => (m as { type: string }).type === "createItem") as { path: string; init: object };
        expect(created).toMatchObject({ path: ENCH, init: { name: "Glowing" }, itemPos: pos(0, 0) });
        expect(chipTexts()).toEqual(["Glowing"]);
        expect(levelChips()).toEqual([]);

        const capacity = $('.ench-mods .cap-block [data-id="capacity"]');
        type(capacity, "2");
        expect($(".ench-mods .mods-label").textContent).toBe("Ench. 2/12:");
    });

    it("deletes an enchantment from its chip", () => {
        loadState(longsword(), pathfinderCrusade);
        const actions = recordingActions();
        rendered = renderBlock(<Gear />, { actions });

        openChip("Self-Balancing");
        const del = enchChips()[1].querySelector<HTMLButtonElement>(".mod-delete")!;
        expect(del.title).toBe("Delete the enchantment");
        act(() => del.click());
        expect(actions.sent.at(-1)).toEqual({ type: "deleteItem", path: `${ENCH}.e2` });
        expect(chipTexts()).toEqual(["Flaming 3"]);
        expect($(".ench-mods .mod-details")).toBeNull();
        expect($(".ench-mods .mods-label").textContent).toBe("Ench. 3/12:");
    });

    it("multiply the weight by Feather's factor, in the header and the encumbrance", () => {
        loadState(withItem({
            name: "Chainmail", weight: 12, gearType: "armour",
            armour: { mods: { items: { m1: { name: "Spikes", weight: 1.5 } }, layouts: { m1: pos(0, 0) } } },
            material: { name: "Mithral", weightFactor: 0.5 },
            enchantments: grid(feather(0)),
        }), pathfinderCrusade);
        attachComputeds(testState());
        rendered = renderBlock(<><CarryWeight /><Gear /></>);

        const total = () => $('[data-id="weightTotal"]');
        expect(total().value).toBe("4.5");
        expect(total().title).toBe(["12 Chainmail", "× 0.5 Mithral", "× 0.5 Feather", "+ 1.5 mods", "= 4.5"].join("\n"));
        expect($('[data-id="encumbrance"]').value).toBe("4.5");

        // Weightless: the mods still weigh.
        openChip("Feather 2");
        chooseLevel("11");
        expect(total().value).toBe("1.5");
        expect($('[data-id="encumbrance"]').value).toBe("1.5");
    });

    it("count their entries while the item is equipped, on any gear type", () => {
        loadState(withItem({ name: "Ring", gearType: "gear", enchantments: grid(flaming(2)) }), pathfinderCrusade);
        attachComputeds(testState());
        const ws = () => value("characteristics.WS.calculatedValue");
        expect(ws()).toBe(35);

        act(() => updateSignalAtPath(testState(), `${G1}.equipped`, false));
        expect(ws()).toBe(30);
        act(() => updateSignalAtPath(testState(), `${G1}.equipped`, true));
        act(() => updateSignalAtPath(testState(), `${G1}.gearType`, "armour"));
        expect(ws()).toBe(35);
    });

    it("sit after the mods of armour and weapons, after the material of other items", () => {
        loadState(longsword(), pathfinderCrusade);
        rendered = renderBlock(<Gear />);
        const ench = () => $<HTMLElement>(".ench-mods");
        expect(ench().previousElementSibling!.getAttribute("data-id")).toBe("weapon");
        expect(getDataPath(ench())).toBe(`${G1}.enchantments.items`);

        act(() => updateSignalAtPath(testState(), `${G1}.gearType`, "armour"));
        expect(ench().parentElement!.classList.contains("gear-armour-fields")).toBe(true);
        expect(ench().previousElementSibling!.getAttribute("data-id")).toBe("armour");
        expect(getDataPath(ench())).toBe(`${G1}.enchantments.items`);
        // Special goes to the attacks of a weapon: armour shows it only when the enchantment has one.
        openChip("Self-Balancing");
        expect($(".ench-special")).toBeNull();
        openChip("Flaming 3");
        expect($(".ench-special")).not.toBeNull();

        act(() => updateSignalAtPath(testState(), `${G1}.gearType`, "tool"));
        expect(ench().previousElementSibling!.classList.contains("material-effects")).toBe(true);
    });

    it("leaves the line out for a viewer of an item without them, and keeps the levels for one with them", () => {
        loadState(longsword([]), pathfinderCrusade);
        rendered = renderBlock(<Gear />, { canEdit: false });
        expect($(".ench-mods")).toBeNull();
        rendered.unmount();
        teardownSheet();

        loadState(longsword(), pathfinderCrusade);
        rendered = renderBlock(<Gear />, { canEdit: false });
        openChip("Flaming 3");
        expect(levelChips().every(b => b.disabled)).toBe(true);
        expect($(".ench-mods .add-mod")).toBeNull();
    });

    it("are not on a Black Crusade sheet", () => {
        loadState(withItem({ name: "Ring", weight: 2, gearType: "gear", enchantments: grid(flaming(2), feather(2)) }));
        attachComputeds(testState());
        rendered = renderBlock(<Gear />);

        expect($(".ench-mods")).toBeNull();
        expect(resolvePath(testState(), `${G1}.enchantments`)).toBeNull();
        expect(value("characteristics.WS.calculatedValue")).toBe(30);
        expect($('[data-id="weight"]').value).toBe("2");
    });
});
