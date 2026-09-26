import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock, type Rendered, getDataPath } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed.js";
import { applyRemoteToState } from "../state/remote";
import { characterState } from "../state/state";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import { CustomSkills } from "./CustomSkills";
import { MentalDisorders, Notes, Talents } from "./NamedDescriptions";
import { PowerShields } from "./PowerShields";
import { ResourceTrackers } from "./ResourceTrackers";
import { advancesAfterClick } from "./skillParts";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;

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
    item(itemId).querySelector<E>(`[data-id="${name}"]`)!;
const columns = (gridId: string, itemClass: string) =>
    Array.from($(`#${gridId}`).querySelectorAll(":scope > .layout-column"), col =>
        Array.from(col.querySelectorAll<HTMLElement>(`:scope > .${itemClass}`), el => el.dataset.id));

describe("name and description lists", () => {
    it("render talents in three columns, collapsed without a description", () => {
        loadState({
            talents: {
                list: {
                    items: { a: { name: "Ambidextrous", description: "Both hands" }, b: { name: "Blind Fighting" }, c: { name: "Cold" } },
                    layouts: { a: pos(2, 0), b: pos(0, 0) },
                },
            },
        });
        const warn = vi.spyOn(console, "warn");
        rendered = renderBlock(<Talents />);

        expect(columns("talents", "item-with-description")).toEqual([["b"], ["c"], ["a"]]);
        expect(field("a", "name").value).toBe("Ambidextrous");
        expect(field<HTMLTextAreaElement>("a", "description").value).toBe("Both hands");
        expect(getDataPath(field("a", "description"))).toBe("talents.list.items.a.description");
        expect(item("a").classList.contains("collapsed")).toBe(false);
        expect(item("b").classList.contains("collapsed")).toBe(true);
        expect(warn).not.toHaveBeenCalled();

        act(() => item("b").querySelector<HTMLButtonElement>(".toggle-button")!.click());
        expect(item("b").classList.contains("collapsed")).toBe(false);
    });

    it("create and delete items and follow remote changes", () => {
        loadState({ notes: { list: { items: { n1: { name: "First" } } } } });
        const actions = recordingActions();
        rendered = renderBlock(<Notes />, { actions });

        act(() => $<HTMLButtonElement>("#notes .add-button").click());
        const created = actions.sent.at(-1) as { type: string; path: string; itemId: string; init: object; itemPos: object };
        expect(created).toMatchObject({ type: "createItem", path: "notes.list.items", init: {}, itemPos: pos(0, 1) });
        expect(created.itemId).toMatch(/^notes-/);
        expect(field(created.itemId, "name").value).toBe("");

        act(() => item("n1").querySelector<HTMLButtonElement>(".delete-button")!.click());
        expect(actions.sent.at(-1)).toEqual({ type: "deleteItem", path: "notes.list.items.n1" });
        expect($("#notes [data-id='n1']")).toBeNull();

        act(() => {
            applyRemoteToState({ type: "createItem", path: "notes.list.items", itemId: "r1", itemPos: pos(0, 0), init: {} });
            applyRemoteToState({ type: "change", path: "notes.list.items.r1.description", change: "remote" });
        });
        expect(field<HTMLTextAreaElement>("r1", "description").value).toBe("remote");
    });

    it("pick a talent from the collection over a new item", () => {
        loadState({ talents: { list: { items: { t1: { name: "Amb", description: "x" } } } } });
        vi.useFakeTimers();
        const autocomplete = recordingAutocomplete();
        const actions = recordingActions();
        rendered = renderBlock(<Talents />, { actions, autocomplete });

        const name = field("t1", "name");
        name.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(250);
        vi.useRealTimers();
        expect(autocomplete.queries).toMatchObject([{ type: "autocomplete", collection: "talents", query: "Amb" }]);

        pickSuggestion(autocomplete, name, { name: "Ambidextrous" });
        expect(actions.sent.at(-1)).toEqual({
            type: "autocompleteApply", path: "talents.list.items.t1", collection: "talents", name: "Ambidextrous", base: {},
        });
    });

    it("keep the insanity points of mental disorders next to the list", () => {
        loadState({ mentalDisorders: { insanityPoints: 12, list: { items: { d1: { name: "Phobia" } } } } });
        rendered = renderBlock(<MentalDisorders />);

        const insanity = $('[data-id="insanityPoints"]');
        expect(insanity.value).toBe("12");
        expect(getDataPath(insanity)).toBe("mentalDisorders.insanityPoints");
        expect(getDataPath(field("d1", "name"))).toBe("mentalDisorders.list.items.d1.name");
    });
});

describe("ResourceTrackers", () => {
    it("lays trackers out in two columns", () => {
        loadState({ resourceTrackers: { list: { items: { r1: { name: "Ammo", value: 3 }, r2: { name: "Fate" } } } } });
        rendered = renderBlock(<ResourceTrackers />);

        expect(columns("resource-trackers", "resource-tracker")).toEqual([["r1"], ["r2"]]);
        expect(field("r1", "value").value).toBe("3");
        expect(field("r1", "value").type).toBe("number");
    });
});

describe("CustomSkills", () => {
    const skills = () => ({
        characteristics: { Cor: { value: "40", unnatural: "4" } },
        customSkills: {
            list: {
                items: { s1: { name: "Forbidden", characteristic: "Cor", plus0: true, plus10: true, miscBonus: 5 } },
                layouts: { s1: pos(0, 0) },
            },
        },
    });

    it("show the difficulty of the skill and roll it", () => {
        loadState(skills());
        attachComputeds(characterState);
        rendered = renderBlock(<CustomSkills />);

        const difficulty = field("s1", "difficulty");
        // 40 + 10 for two advances + 5.
        expect(difficulty.value).toBe("55");
        expect(difficulty.readOnly).toBe(true);
        expect(difficulty.classList.contains("rollable")).toBe(true);

        const roll = vi.fn();
        document.addEventListener("sheet:rollVersus", roll);
        difficulty.click();
        document.removeEventListener("sheet:rollVersus", roll);
        expect(roll.mock.calls[0][0].detail).toEqual({ target: 55, bonusSuccesses: 2, label: "Forbidden" });

        act(() => updateSignalAtPath("customSkills.list.items.s1.plus20", true));
        expect(difficulty.value).toBe("65");
    });

    it("send the four advances as one batch of the row", () => {
        loadState(skills());
        const actions = recordingActions();
        rendered = renderBlock(<CustomSkills />, { actions });
        // A click fires input and change; neither sends the checkbox alone.
        const click = (box: HTMLInputElement, checked: boolean) => {
            box.checked = checked;
            box.dispatchEvent(new Event("input", { bubbles: true }));
            box.dispatchEvent(new Event("change", { bubbles: true }));
        };

        click(field("s1", "plus30"), true);
        expect(actions.scheduled).toEqual([[{
            type: "batch",
            path: "customSkills.list.items.s1",
            changes: { plus0: true, plus10: true, plus20: true, plus30: true },
        }, "customSkills.list.items.s1"]]);

        click(field("s1", "plus0"), false);
        expect(actions.scheduled).toHaveLength(2);
        expect(actions.scheduled[1][0]).toMatchObject({ changes: { plus0: false, plus10: false, plus20: false, plus30: false } });
    });

    it("follow the rule of advances: checked boxes fill up, unchecked ones clear what follows", () => {
        const none = { plus0: false, plus10: false, plus20: false, plus30: false };
        expect(advancesAfterClick(none, "plus20", true)).toEqual({ plus0: true, plus10: true, plus20: true, plus30: false });
        const all = { plus0: true, plus10: true, plus20: true, plus30: true };
        expect(advancesAfterClick(all, "plus10", false)).toEqual({ plus0: true, plus10: false, plus20: false, plus30: false });
    });
});

describe("PowerShields", () => {
    it("roll d100 from the name label and follow the fields", () => {
        loadState({ powerShields: { list: { items: { p1: { name: "Rosarius", rating: "50", nature: "arcane" } } } } });
        rendered = renderBlock(<PowerShields />);

        expect(field<HTMLSelectElement>("p1", "nature").value).toBe("arcane");
        expect(field<HTMLSelectElement>("p1", "type").value).toBe("dome");
        expect(item("p1").classList.contains("collapsed")).toBe(false);

        const roll = vi.fn();
        document.addEventListener("sheet:rollExact", roll);
        item("p1").querySelector<HTMLElement>(".name label")!.click();
        document.removeEventListener("sheet:rollExact", roll);
        expect(roll.mock.calls[0][0].detail).toEqual({ expression: "d100", label: "Rosarius 50" });
    });

    it("render nothing to edit without edit rights", () => {
        loadState({ powerShields: { list: { items: { p1: { name: "Rosarius" } } } } });
        rendered = renderBlock(<PowerShields />, { canEdit: false });

        expect(rendered.container.querySelectorAll(".add-button, .drag-handle, .delete-button")).toHaveLength(0);
        expect(field("p1", "name").readOnly).toBe(true);
        expect(field<HTMLSelectElement>("p1", "nature").disabled).toBe(true);
        expect(value("powerShields.list.items.p1.name")).toBe("Rosarius");
    });
});
