import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import {
    getDataPath, loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock, teardownSheet, testState,
    type Rendered,
} from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { updateSignalAtPath } from "../state/sync";
import { CarryWeight, Gear } from "./Gear";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const G1 = "gear.list.items.g1";
const MODS = `${G1}.weapon.mods.items`;

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const chips = () => Array.from(rendered!.container.querySelectorAll<HTMLElement>(".mod-chip"));

/** A hunting rifle with Scope (0.4 kg) and Silencer, and armour mods left from when it was typed as armour. */
const rifle = () => ({
    gear: {
        list: {
            items: {
                g1: {
                    name: "Hunting Rifle", weight: 4, gearType: "weapon", carried: true, description: "Long barrel.",
                    weapon: {
                        mods: {
                            items: { m1: { name: "Scope", weight: 0.4, description: "No long range penalty" }, m2: { name: "Silencer" } },
                            layouts: { m1: pos(0, 0), m2: pos(0, 1) },
                        },
                    },
                    armour: { mods: { items: { a1: { name: "Sealed", weight: 2 } }, layouts: { a1: pos(0, 0) } } },
                },
            },
            layouts: { g1: pos(0, 0) },
        },
    },
    carryWeightAndEncumbrance: { carryWeightBase: 8 },
});

describe("Weapon mods", () => {
    it("shows the mods of a weapon as chips, with a weight and a description but no conditions", () => {
        loadState(rifle());
        rendered = renderBlock(<Gear />);

        expect($(".gear-armour-fields")).toBeNull();
        expect(chips().map(c => c.textContent)).toEqual(["Scope✖", "Silencer✖"]);

        act(() => chips()[0].querySelector<HTMLButtonElement>(".mod-chip-name")!.click());
        const weight = $('.mod-details [data-id="weight"]');
        expect(weight.value).toBe("0.4");
        expect(getDataPath(weight)).toBe(`${MODS}.m1.weight`);
        expect($<HTMLTextAreaElement>('.mod-details [data-id="description"]').value).toBe("No long range penalty");
        expect($(".mod-details .add-first-condition")).toBeNull();
    });

    it("counts the weights of the mods while the item is a weapon", () => {
        loadState(rifle());
        attachComputeds(testState());
        rendered = renderBlock(<CarryWeight />);

        expect($('[data-id="encumbrance"]').value).toBe("4.4");
        // As armour the item counts the armour's mods instead.
        act(() => updateSignalAtPath(testState(), `${G1}.gearType`, "armour"));
        expect($('[data-id="encumbrance"]').value).toBe("6");
        act(() => updateSignalAtPath(testState(), `${G1}.gearType`, "tool"));
        expect($('[data-id="encumbrance"]').value).toBe("4");
    });

    it("picks a mod from the weaponMods collection", () => {
        loadState(rifle());
        const actions = recordingActions();
        const autocomplete = recordingAutocomplete();
        rendered = renderBlock(<Gear />, { actions, autocomplete });

        act(() => $<HTMLButtonElement>(`[data-id="weapon"] .add-mod`).click());
        pickSuggestion(autocomplete, $(".mod-add input"), { name: "Red-Dot", name_ru: "Коллиматор", entryType: "Sights" });
        const created = actions.sent.find(m => (m as { type: string }).type === "createItem") as { path: string; itemId: string; itemPos: object };
        expect(created).toMatchObject({ path: MODS, itemPos: pos(0, 2) });
        expect(actions.sent.at(-1)).toMatchObject({
            type: "autocompleteApply", path: `${MODS}.${created.itemId}`, collection: "weaponMods", name: "Red-Dot",
        });
    });
});
