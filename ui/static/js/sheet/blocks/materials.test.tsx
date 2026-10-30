import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import {
    applyRemote, loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock,
    teardownSheet, testState, type Rendered,
} from "../components/testUtils";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { armourComputeds } from "../state/armour";
import { attachComputeds } from "../state/computed";
import { itemCapacity, type GearItem } from "../state/materials";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { Armour } from "./Armour";
import { CarryWeight, Gear } from "./Gear";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const G1 = "gear.list.items.g1";

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const lines = (...l: string[]) => l.join("\n");

/** Mithral as an item keeps it. */
const mithral = {
    name: "Mithral", weightFactor: 0.5, durability: 2, capacityFactor: 1, ap: 1, pen: 1, short: "+20 Max.A",
    special: "Броня получает +20 Max.A.", entries: { items: {}, layouts: {} },
};

/** What the server sends for Mithral (materials.json through the Go loader), with the fields the sheet does not keep. */
const MITHRAL = {
    ...mithral, name_ru: "Мифрил", entryType: "Металл", use: "Универсальный", rarity: 3, priceFactor: 15, bankFactor: 1,
    description: "Лёгкий серебристый металл.",
};

/** A mithral chainmail of 12 kg, AP 4 on torso, arms and legs, with Spikes of 1.5 kg; equipped. */
const chainmail = (item: object = {}) => ({
    characteristics: { T: { value: "30" } },
    gear: {
        list: {
            items: {
                g1: {
                    name: "Chainmail", weight: 12, gearType: "armour", carried: true, equipped: true,
                    armour: {
                        ap: { head: "", torso: "4", arms: "4", legs: "4" },
                        mods: { items: { m1: { name: "Spikes", weight: 1.5 } }, layouts: { m1: pos(0, 0) } },
                    },
                    material: mithral,
                    ...item,
                },
            },
            layouts: { g1: pos(0, 0) },
        },
    },
    carryWeightAndEncumbrance: { carryWeightBase: 8 },
});

/** A longsword of 3 kg without a material. */
const longsword = {
    gear: {
        list: {
            items: { g1: { name: "Longsword", weight: 3, gearType: "weapon", carried: true, equipped: true, description: "Fine steel" } },
            layouts: { g1: pos(0, 0) },
        },
    },
};

const item = () => resolvePath(testState(), G1) as GearItem;

describe("the material of a gear item", () => {
    it("is picked from the materials and keeps the numbers the sheet computes with", () => {
        loadState(longsword, pathfinderCrusade);
        attachComputeds(testState());
        const actions = recordingActions();
        const autocomplete = recordingAutocomplete();
        rendered = renderBlock(<Gear />, { actions, autocomplete });

        const input = $('.material-row [data-id="name"]');
        expect(input.placeholder).toBe("—");
        expect($(".material-effects")).toBeNull();
        pickSuggestion(autocomplete, input, { name: "Mithral", name_ru: "Мифрил", entryType: "Металл" });
        expect(actions.sent.at(-1)).toMatchObject({ type: "autocompleteApply", path: `${G1}.material`, collection: "materials", name: "Mithral", base: {} });

        act(() => applyRemote({ type: "autocompleteApplied", path: `${G1}.material`, changes: MITHRAL }));
        expect(input.value).toBe("Mithral");
        expect(input.title).toBe("Броня получает +20 Max.A.");
        expect(item().material).not.toHaveProperty("name_ru");
        // A weapon: Pen, not AP, dimmed until attacks are linked to the item.
        expect($(".material-effects").textContent).toBe("wt ×0.5 · Pen +1 · Dur 2 · Cap ×1 · +20 Max.A");
        expect($('[data-id="materialPen"]').title).toBe("Counts in the attacks linked to the item");

        const total = $('[data-id="weightTotal"]');
        expect(total.value).toBe("1.5");
        expect(total.title).toBe(lines("3 Longsword", "× 0.5 Mithral", "= 1.5"));
    });

    it("drops its effects when its name is cleared", () => {
        loadState(chainmail(), pathfinderCrusade);
        attachComputeds(testState());
        rendered = renderBlock(<Gear />);
        expect($(".material-effects")).not.toBeNull();

        act(() => updateSignalAtPath(testState(), `${G1}.material.name`, ""));
        expect($(".material-effects")).toBeNull();
        expect($('[data-id="weightTotal"]').value).toBe("13.5");
        expect($('[data-id="torsoTotal"]')).toBeNull();
    });

    it("multiplies the own weight, then adds the mods, in the header and the encumbrance", () => {
        loadState(chainmail(), pathfinderCrusade);
        attachComputeds(testState());
        rendered = renderBlock(<><CarryWeight /><Gear /></>);

        const total = $('[data-id="weightTotal"]');
        expect(total.value).toBe("7.5");
        expect(total.title).toBe(lines("12 Chainmail", "× 0.5 Mithral", "+ 1.5 mods", "= 7.5"));
        expect($('[data-id="encumbrance"]').value).toBe("7.5");

        act(() => { total.dispatchEvent(new FocusEvent("focus")); });
        const own = $('.split-header [data-id="weight"]');
        expect(own.value).toBe("12");
        expect(rendered!.container.ownerDocument.activeElement).toBe(own);
    });

    it("adds its AP to the covered locations, own AP on focus", () => {
        loadState(chainmail(), pathfinderCrusade);
        rendered = renderBlock(<Gear />);

        expect($(".material-effects").textContent).toBe("wt ×0.5 · AP +1 · Dur 2 · Cap ×1 · +20 Max.A");
        const torso = $('[data-id="ap"] [data-id="torsoTotal"]');
        expect(torso.value).toBe("5");
        expect(torso.classList.contains("ap-total")).toBe(true);
        expect(torso.title).toBe(lines("4 Chainmail", "+1 Mithral", "= 5"));
        // The head is not covered: its field stays, empty.
        expect($('[data-id="ap"] [data-id="headTotal"]')).toBeNull();
        expect($('[data-id="ap"] [data-id="head"]').value).toBe("");
        // Super armour is the item's own.
        expect($('[data-id="superAp"] [data-id="torsoTotal"]')).toBeNull();

        act(() => { torso.dispatchEvent(new FocusEvent("focus")); });
        const own = $('[data-id="ap"] [data-id="torso"]');
        expect(own.value).toBe("4");
        expect(rendered!.container.ownerDocument.activeElement).toBe(own);
        act(() => { own.dispatchEvent(new FocusEvent("blur")); });
        expect($('[data-id="ap"] [data-id="torsoTotal"]').value).toBe("5");
    });

    it("halves the AP after the material, rounded down, while the item is broken", () => {
        loadState(chainmail(), pathfinderCrusade);
        const actions = recordingActions();
        rendered = renderBlock(<Gear />, { actions });

        const broken = $('[data-id="broken"]');
        expect(broken.closest(".centered-content")).not.toBeNull();
        act(() => broken.click());
        expect(actions.scheduled.at(-1)![0]).toEqual({ type: "change", path: `${G1}.broken`, change: true });
        const torso = $('[data-id="ap"] [data-id="torsoTotal"]');
        expect(torso.value).toBe("2");
        expect(torso.title).toBe(lines("4 Chainmail", "+1 Mithral", "÷ 2 Broken", "= 2"));

        // Broken alone modifies the AP too.
        act(() => updateSignalAtPath(testState(), `${G1}.material.name`, ""));
        expect($('[data-id="ap"] [data-id="torsoTotal"]').value).toBe("2");
        act(() => updateSignalAtPath(testState(), `${G1}.armour.ap.torso`, "1"));
        expect($('[data-id="ap"] [data-id="torsoTotal"]').value).toBe("0");
    });

    it("shows Broken only on weapons and armour", () => {
        loadState(chainmail({ gearType: "gear" }), pathfinderCrusade);
        rendered = renderBlock(<Gear />);
        expect($('[data-id="broken"]')).toBeNull();
        // Any item can have a material: it changes its weight and capacity.
        expect($(".material-effects").textContent).toBe("wt ×0.5 · Dur 2 · Cap ×1 · +20 Max.A");
    });

    it("counts the same AP in the Armour block", () => {
        loadState(chainmail(), pathfinderCrusade);
        attachComputeds(testState());
        const parts = armourComputeds(testState()).parts;
        expect(parts.body.gearArmour.value).toBe(5);
        expect(parts.leftArm.gearArmour.value).toBe(5);
        expect(parts.head.pieces.value).toEqual([]);

        rendered = renderBlock(<Armour />);
        const body = $<HTMLElement>('.body-part[data-id="body"]');
        act(() => body.querySelector<HTMLButtonElement>(".armour-extra-toggle")!.click());
        expect(body.querySelector(".armour-contributions")!.textContent).toBe("ArmourChainmail+5");

        act(() => updateSignalAtPath(testState(), `${G1}.broken`, true));
        expect(body.querySelector(".armour-contributions")!.textContent).toBe("ArmourChainmail+2");
        expect(parts.body.gearArmour.value).toBe(2);
    });

    it("gives the item a capacity of 8 times the material's factor plus the gem's bonus", () => {
        loadState(longsword, pathfinderCrusade);
        expect(itemCapacity(item())).toEqual({ total: 8, lines: ["8 base", "= 8"] });

        act(() => updateSignalAtPath(testState(), `${G1}.inlay`, "Ruby"));
        expect(itemCapacity(item()).total).toBe(12);

        act(() => {
            updateSignalAtPath(testState(), `${G1}.material.name`, "Silk");
            updateSignalAtPath(testState(), `${G1}.material.capacityFactor`, 3);
            updateSignalAtPath(testState(), `${G1}.inlay`, "Diamond");
        });
        expect(itemCapacity(item())).toEqual({ total: 32, lines: ["8 base", "× 3 Silk", "+ 8 Diamond", "= 32"] });

        rendered = renderBlock(<Gear />);
        expect($('[data-id="capacity"]').title).toBe(lines("Capacity for enchantments:", "8 base", "× 3 Silk", "+ 8 Diamond", "= 32"));
    });

    it("takes the inlay from the five gems", () => {
        loadState(longsword, pathfinderCrusade);
        rendered = renderBlock(<Gear />);
        const inlay = $<HTMLSelectElement>('.material-row [data-id="inlay"]');
        expect(Array.from(inlay.options).map(o => o.textContent))
            .toEqual(["—", "Quartz +1", "Onyx +2", "Ruby +4", "Emerald +6", "Diamond +8"]);
        inlay.value = "Emerald";
        act(() => { inlay.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(item().inlay?.value).toBe("Emerald");
    });

    it("leaves the row out for a viewer of an item without material or gem", () => {
        loadState(longsword, pathfinderCrusade);
        rendered = renderBlock(<Gear />, { canEdit: false });
        expect($(".material-row")).toBeNull();
    });

    it("is not on a Black Crusade sheet", () => {
        loadState(chainmail({ broken: true, inlay: "Ruby" }));
        attachComputeds(testState());
        rendered = renderBlock(<Gear />);

        expect($(".material-row")).toBeNull();
        expect($(".material-effects")).toBeNull();
        expect($('[data-id="broken"]')).toBeNull();
        expect($('[data-id="ap"] [data-id="torsoTotal"]')).toBeNull();
        expect($('[data-id="ap"] [data-id="torso"]').value).toBe("4");
        expect($('[data-id="weightTotal"]').value).toBe("13.5");
        expect(armourComputeds(testState()).parts.body.gearArmour.value).toBe(4);
    });
});
