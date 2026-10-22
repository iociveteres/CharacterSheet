import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import {
    applyRemote, getDataPath, loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock,
    teardownSheet, testState, type Rendered,
} from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { CarryWeight, Gear } from "./Gear";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;
const G1 = "gear.list.items.g1";
const MODS = `${G1}.armour.mods.items`;

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const chips = () => Array.from(rendered!.container.querySelectorAll<HTMLElement>(".mod-chip"));
const chip = (name: string) => chips().find(c => c.querySelector(".mod-chip-name")!.textContent === name)!;
const press = (input: HTMLInputElement, key: string) =>
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });

/** Carapace with Sealed (no weight), Backpack (3 kg) and Cosmetic (+5 Intimidate); the rows put Backpack first. */
const armour = () => ({
    characteristics: { WS: { value: "30" } },
    gear: {
        list: {
            items: {
                g1: {
                    name: "Carapace", weight: 12, gearType: "armour", carried: true, equipped: true, description: "Plates",
                    armour: {
                        ap: { torso: "6" },
                        mods: {
                            items: {
                                m1: { name: "Sealed" },
                                m2: { name: "Backpack", weight: 3, description: "Batteries" },
                                m3: {
                                    name: "Cosmetic", weight: 0.5,
                                    entries: { items: { e1: { type: "char_bonus", name: "WS", bonus: "5" } }, layouts: { e1: pos(0, 0) } },
                                },
                            },
                            layouts: { m1: pos(0, 1), m2: pos(0, 0), m3: pos(0, 2) },
                        },
                    },
                },
            },
            layouts: { g1: pos(0, 0) },
        },
    },
    carryWeightAndEncumbrance: { carryWeightBase: 8 },
});

describe("Gear mods", () => {
    it("counts the weights of the mods and their entries while the item is equipped armour", () => {
        loadState(armour());
        attachComputeds(testState());
        rendered = renderBlock(<CarryWeight />);
        const ws = () => value("characteristics.WS.calculatedValue");

        expect($('[data-id="encumbrance"]').value).toBe("15.5");
        expect(ws()).toBe(35);

        act(() => updateSignalAtPath(testState(), `${G1}.equipped`, false));
        expect(ws()).toBe(30);
        expect($('[data-id="encumbrance"]').value).toBe("15.5");
        act(() => updateSignalAtPath(testState(), `${G1}.equipped`, true));

        // Hidden with the armour fieldset, the mods count no more, as its AP.
        act(() => updateSignalAtPath(testState(), `${G1}.gearType`, "gear"));
        expect(ws()).toBe(30);
        expect($('[data-id="encumbrance"]').value).toBe("12");
    });

    it("shows the mods as chips in the order of their rows and opens one at a time", () => {
        loadState(armour());
        rendered = renderBlock(<Gear />);

        expect(chips().map(c => c.textContent)).toEqual(["Backpack✖", "Sealed✖", "Cosmetic✖"]);
        expect(chip("Cosmetic").classList.contains("has-entries")).toBe(true);
        expect(chip("Backpack").classList.contains("has-entries")).toBe(false);
        expect($(".mod-details")).toBeNull();
        // The description is collapsed, but an item with mods has content.
        expect($('[data-id="g1"]').classList.contains("collapsed")).toBe(false);

        act(() => chip("Backpack").querySelector<HTMLButtonElement>(".mod-chip-name")!.click());
        expect(chip("Backpack").classList.contains("open")).toBe(true);
        const weight = $('.mod-details [data-id="weight"]');
        expect(weight.value).toBe("3");
        expect(getDataPath(weight)).toBe(`${MODS}.m2.weight`);
        expect($<HTMLTextAreaElement>('.mod-details [data-id="description"]').value).toBe("Batteries");
        expect($(".mod-details .add-first-condition")).not.toBeNull();

        act(() => chip("Cosmetic").querySelector<HTMLButtonElement>(".mod-chip-name")!.click());
        expect(rendered!.container.querySelectorAll(".mod-details")).toHaveLength(1);
        expect(chip("Backpack").classList.contains("open")).toBe(false);
        expect(getDataPath($('.mod-details [data-id="bonus"]'))).toBe(`${MODS}.m3.entries.items.e1.bonus`);
        // The entries of a mod are its own grid, without the item's fieldset.
        expect($(".mod-details .gear-condition-fields")).toBeNull();

        act(() => chip("Cosmetic").querySelector<HTMLButtonElement>(".mod-chip-name")!.click());
        expect($(".mod-details")).toBeNull();
    });

    it("adds a mod of a typed name at the end and opens it", () => {
        loadState(armour());
        const actions = recordingActions();
        rendered = renderBlock(<Gear />, { actions });

        act(() => $<HTMLButtonElement>(".add-mod").click());
        const input = $(".mod-add input");
        expect(rendered!.container.ownerDocument.activeElement).toBe(input);
        expect($(".add-mod")).toBeNull();

        input.value = "Spikes";
        press(input, "Enter");
        const created = actions.sent.find(m => (m as { type: string }).type === "createItem") as { path: string; itemId: string; init: object; itemPos: object };
        expect(created).toMatchObject({ path: MODS, init: { name: "Spikes" }, itemPos: pos(0, 3) });
        expect(created.itemId).toMatch(/^mod-/);
        expect(actions.scheduled.at(-1)![0]).toMatchObject({ type: "positionsChanged", path: MODS });
        expect(chips().at(-1)!.textContent).toBe("Spikes✖");
        expect(chips().at(-1)!.classList.contains("open")).toBe(true);
        expect($('.mod-details [data-id="name"]').value).toBe("Spikes");
        expect($(".mod-add")).toBeNull();
    });

    it("lays the collection's mod over a picked one and closes the empty line on Esc", () => {
        loadState(armour());
        const actions = recordingActions();
        const autocomplete = recordingAutocomplete();
        rendered = renderBlock(<Gear />, { actions, autocomplete });

        act(() => $<HTMLButtonElement>(".add-mod").click());
        pickSuggestion(autocomplete, $(".mod-add input"), { name: "Ceramite", name_ru: "Керамит", entryType: "Reinforcement" });
        const created = actions.sent.find(m => (m as { type: string }).type === "createItem") as { itemId: string };
        expect(actions.sent.at(-1)).toMatchObject({
            type: "autocompleteApply", path: `${MODS}.${created.itemId}`, collection: "armourMods", name: "Ceramite",
        });

        act(() => applyRemote({
            type: "autocompleteApplied", path: `${MODS}.${created.itemId}`,
            changes: { name: "Ceramite", weight: 2, description: "+3 AP vs E(Fl)" },
        }));
        expect($<HTMLTextAreaElement>('.mod-details [data-id="description"]').value).toBe("+3 AP vs E(Fl)");

        act(() => $<HTMLButtonElement>(".add-mod").click());
        press($(".mod-add input"), "Escape");
        expect($(".mod-add")).toBeNull();
        expect($(".add-mod")).not.toBeNull();
    });

    it("deletes a mod from its chip and closes it if it was open", () => {
        loadState(armour());
        const actions = recordingActions();
        rendered = renderBlock(<Gear />, { actions });

        act(() => chip("Sealed").querySelector<HTMLButtonElement>(".mod-chip-name")!.click());
        act(() => chip("Sealed").querySelector<HTMLButtonElement>(".mod-delete")!.click());
        expect(actions.sent.at(-1)).toEqual({ type: "deleteItem", path: `${MODS}.m1` });
        expect(chips().map(c => c.textContent)).toEqual(["Backpack✖", "Cosmetic✖"]);
        expect($(".mod-details")).toBeNull();
    });

    it("leaves the line of mods out for a viewer of armour without them", () => {
        const content = armour();
        content.gear.list.items.g1.armour.mods = { items: {}, layouts: {} } as never;
        loadState(content);
        rendered = renderBlock(<Gear />, { canEdit: false });
        expect($(".item-mods")).toBeNull();
    });

    it("shows the weight with the mods' until the field is focused", () => {
        loadState(armour());
        attachComputeds(testState());
        rendered = renderBlock(<Gear />);

        const total = $('[data-id="weightTotal"]');
        expect(total.value).toBe("15.5");
        expect(total.title).toBe("12 + 3.5 mods");
        expect($('.split-header [data-id="weight"]')).toBeNull();

        act(() => { total.dispatchEvent(new FocusEvent("focus")); });
        const own = $('.split-header [data-id="weight"]');
        expect(own.value).toBe("12");
        expect(rendered!.container.ownerDocument.activeElement).toBe(own);

        act(() => { own.dispatchEvent(new FocusEvent("blur")); });
        expect($('[data-id="weightTotal"]').value).toBe("15.5");

        // Without weighing mods the item's own weight shows.
        act(() => updateSignalAtPath(testState(), `${MODS}.m2.weight`, null));
        act(() => updateSignalAtPath(testState(), `${MODS}.m3.weight`, 0));
        expect($('.split-header [data-id="weight"]').value).toBe("12");
    });
});
