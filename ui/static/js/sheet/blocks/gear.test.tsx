import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { loadState, recordingActions, renderBlock, type Rendered, getDataPath } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { applyRemoteToState } from "../state/remote";
import { characterState } from "../state/state";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import { Experience } from "./Experience";
import { CarryWeight, Cybernetics, Gear } from "./Gear";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;
const G1 = "gear.list.items.g1";

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    teardownSheet();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const item = (id: string) => $<HTMLElement>(`[data-id="${id}"]`);
const field = <E extends Element = HTMLInputElement>(itemId: string, name: string) =>
    item(itemId).querySelector<E>(`[data-id="${name}"]`);

const gear = () => ({
    characteristics: { WS: { value: "30" } },
    gear: {
        list: {
            items: {
                g1: {
                    name: "Carapace", weight: 7.5, gearType: "armour", carried: true, equipped: true,
                    armour: { ap: { head: "5", torso: "6" } },
                    entries: { items: { e1: { type: "char_bonus", name: "WS", bonus: "5" } }, layouts: { e1: pos(0, 0) } },
                },
                g2: { name: "Rope", weight: 1.25, carried: true },
            },
            layouts: { g1: pos(0, 0), g2: pos(1, 0) },
        },
    },
    cybernetics: { list: { items: { i1: { name: "Eye", description: "Sees" } } } },
    carryWeightAndEncumbrance: { carryWeightBase: 4 },
});

describe("Gear", () => {
    it("renders the armour and the entries of an item at their state paths", () => {
        loadState(gear());
        const warn = vi.spyOn(console, "warn");
        rendered = renderBlock(<Gear />);

        expect(field("g1", "name")!.value).toBe("Carapace");
        expect(field("g1", "weight")!.value).toBe("7.5");
        expect(field("g1", "carried")!.checked).toBe(true);
        const head = item("g1").querySelector<HTMLInputElement>('[data-id="ap"] [data-id="head"]')!;
        expect(head.value).toBe("5");
        expect(getDataPath(head)).toBe(`${G1}.armour.ap.head`);
        expect(getDataPath(field("e1", "bonus")!)).toBe(`${G1}.entries.items.e1.bonus`);
        // A rope is no armour and has no entries yet.
        expect(item("g2").querySelector(".gear-armour-fields")).toBeNull();
        expect(item("g2").querySelector(".add-first-condition")).not.toBeNull();
        expect(item("g1").querySelector(".add-first-condition")).toBeNull();
        // Without a description both start collapsed, as the old items did.
        expect(item("g1").classList.contains("collapsed")).toBe(true);
        expect(warn).not.toHaveBeenCalled();

        act(() => updateSignalAtPath(`${G1}.gearType`, "tool"));
        expect(item("g1").querySelector(".gear-armour-fields")).toBeNull();
    });

    it("creates carried gear and adds the first entry from the stub", () => {
        loadState(gear());
        const actions = recordingActions();
        rendered = renderBlock(<Gear />, { actions });

        act(() => $<HTMLButtonElement>('#gear > [data-column="2"] .add-button').click());
        expect(actions.sent.at(-1)).toMatchObject({ type: "createItem", path: "gear.list.items", init: { carried: true }, itemPos: pos(2, 0) });

        act(() => item("g2").querySelector<HTMLButtonElement>(".add-first-condition")!.click());
        const entry = actions.sent.at(-1) as { path: string; itemId: string; init: object; itemPos: object };
        expect(entry).toMatchObject({ path: "gear.list.items.g2.entries.items", init: {}, itemPos: pos(0, 0) });
        expect(entry.itemId).toMatch(/^entries-g2-/);
        expect(value(`gear.list.items.g2.entries.items.${entry.itemId}.type`)).toBe("char_bonus");
        expect(item("g2").querySelector(".add-first-condition")).toBeNull();
    });

    it("adds the entries of equipped gear to characteristics and replaces them from autocomplete", () => {
        loadState(gear());
        attachComputeds(characterState);
        rendered = renderBlock(<Gear />);
        const ws = () => value("characteristics.WS.calculatedValue");
        expect(ws()).toBe(35);

        act(() => updateSignalAtPath(`${G1}.equipped`, false));
        expect(ws()).toBe(30);
        act(() => updateSignalAtPath(`${G1}.equipped`, true));

        act(() => {
            applyRemoteToState({
                type: "autocompleteApplied", path: G1,
                changes: {
                    carried: true, name: "Power Armour",
                    entries: { items: { x1: { type: "char_bonus", name: "WS", bonus: "10" } }, layouts: { x1: pos(0, 0) } },
                },
            });
        });
        expect(field("g1", "name")!.value).toBe("Power Armour");
        expect(field("x1", "bonus")!.value).toBe("10");
        // The collection entry was laid over a new item: the old armour and type are gone.
        expect(value(`${G1}.gearType`)).toBe("");
        expect(value(`${G1}.equipped`)).toBe(false);
        expect(ws()).toBe(30);
        expect(item("g1").classList.contains("collapsed")).toBe(false);
    });
});

describe("Cybernetics", () => {
    it("renders implants with their entries grid", () => {
        loadState(gear());
        rendered = renderBlock(<Cybernetics />);

        expect(field<HTMLTextAreaElement>("i1", "description")!.value).toBe("Sees");
        expect(item("i1").classList.contains("collapsed")).toBe(false);
        expect(item("i1").querySelector('[data-id="entries.items"].condition-entries')).not.toBeNull();
    });
});

describe("CarryWeight", () => {
    it("shows the weights of the base and the encumbrance of carried gear", () => {
        loadState(gear());
        attachComputeds(characterState);
        rendered = renderBlock(<CarryWeight />);

        expect($('[data-id="carryWeight"]').value).toBe("18");
        expect($('[data-id="encumbrance"]').value).toBe("8.75");
        expect($('[data-id="encumbrance"]').readOnly).toBe(true);

        act(() => updateSignalAtPath("gear.list.items.g2.carried", false));
        expect($('[data-id="encumbrance"]').value).toBe("7.5");
    });
});

describe("Experience", () => {
    const experience = () => ({
        characteristics: { WS: { value: "30" } },
        experience: {
            experienceTotal: 1000,
            useAptitudes: true,
            aptitudes: "WS, Off",
            experienceLog: {
                items: {
                    x1: { name: "WS +5", type: "characteristic", level: 1, aptitudes: "WS, Off" },
                    x2: { name: "Elite", type: "eliteArchetype", experienceCost: 300 },
                },
                layouts: { x1: pos(0, 0), x2: pos(1, 0) },
            },
        },
    });

    it("shows the fields of the advancement type and its cost", () => {
        loadState(experience());
        attachComputeds(characterState);
        const warn = vi.spyOn(console, "warn");
        rendered = renderBlock(<Experience />);

        // Two matching aptitudes: the cheapest characteristic cost.
        expect(field("x1", "computedCost")!.value).toBe("100");
        expect(field("x1", "experienceCost")).toBeNull();
        expect(field<HTMLSelectElement>("x1", "level")!.options).toHaveLength(5);
        expect(field("x1", "hostileTo")).not.toBeNull();
        expect(field("x2", "experienceCost")!.value).toBe("300");
        expect(field("x2", "level")).toBeNull();
        expect($('[data-id="experienceSpent"]').value).toBe("400");
        expect($('[data-id="experienceRemaining"]').value).toBe("600");
        expect(getDataPath(field("x1", "level")!)).toBe("experience.experienceLog.items.x1.level");
        expect(warn).not.toHaveBeenCalled();

        act(() => updateSignalAtPath("experience.experienceLog.items.x1.type", "talent"));
        expect(field<HTMLSelectElement>("x1", "level")!.options).toHaveLength(3);
        expect(field("x1", "hostileTo")).toBeNull();
    });

    it("keeps advancements collapsed when a remote batch changes them", () => {
        loadState(experience());
        rendered = renderBlock(<Experience />);
        expect(item("x1").classList.contains("collapsed")).toBe(true);

        act(() => { applyRemoteToState({ type: "batch", path: "experience.experienceLog.items.x1", changes: { name: "WS +10" } }); });
        expect(field("x1", "name")!.value).toBe("WS +10");
        expect(item("x1").classList.contains("collapsed")).toBe(true);
    });
});
