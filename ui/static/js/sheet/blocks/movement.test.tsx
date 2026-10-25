import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { flush, loadState, recordingActions, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { Movement, MovementHeading } from "./Combat";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;
const MODES = "movement.modes.items";

const content = () => ({
    characteristics: { A: { value: "35" }, S: { value: "42" } },
    size: 1,
    traits: {
        list: {
            items: { t1: { name: "Flyer (8)" }, t2: { name: "Digitigrade (2)" }, t3: { name: "Brutal Charge (3)" } },
            layouts: { t1: pos(0, 0), t2: pos(0, 1), t3: pos(0, 2) },
        },
    },
    movement: {
        modes: {
            items: { m1: { name: "Move", spd: "A.b+Size", halfMult: 1, fullMult: 2, chargeMult: 3, runMult: 6 } },
            layouts: { m1: pos(0, 0) },
        },
    },
});

let rendered: Rendered | null = null;

beforeEach(() => {
    loadState(content());
    attachComputeds(testState());
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const dropdown = () => $<HTMLElement>(".movement-dropdown");
const toggle = () => $<HTMLButtonElement>(".block-settings-toggle")!;
const mode = (id: string) => $<HTMLElement>(`.movement-modes [data-id="${id}"]`)!;
const field = (id: string, name: string) => mode(id).querySelector<HTMLInputElement>(`[data-id="${name}"]`)!;
const options = () => Array.from(rendered!.container.querySelectorAll(".movement-dropdown .autocomplete-option"), el => el.textContent);
const type = (input: HTMLInputElement, text: string) => act(() => {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
});
const key = (input: HTMLInputElement, k: string) => act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });
const block = () => <><MovementHeading /><Movement /></>;

describe("the movement modes under ⚙", () => {
    it("opens from the gear by the heading with a row per mode", () => {
        rendered = renderBlock(block());
        expect($("h3")!.textContent).toBe("Movement");
        expect(dropdown()).toBeNull();
        act(() => toggle().click());
        expect(field("m1", "name").value).toBe("Move");
        expect(field("m1", "spd").value).toBe("A.b+Size");
        expect(mode("m1").querySelector('[data-id="spdValue"]')!.textContent).toBe("= 4");
        expect(["halfMult", "fullMult", "chargeMult", "runMult"].map(m => field("m1", m).value)).toEqual(["1", "2", "3", "6"]);
    });

    it("changes the table as the SPD and the multipliers change", () => {
        rendered = renderBlock(block());
        act(() => toggle().click());
        type(field("m1", "spd"), "A.b+Size+2");
        expect(value(`${MODES}.m1.spd`)).toBe("A.b+Size+2");
        expect(mode("m1").querySelector('[data-id="spdValue"]')!.textContent).toBe("= 6");
        act(() => updateSignalAtPath(testState(), `${MODES}.m1.runMult`, 12));
        expect($<HTMLInputElement>(`[data-id="modes.items.m1"] [data-id="run"]`)!.value).toBe("72");
    });

    it("outlines an SPD with dice and shows no distances for it", () => {
        rendered = renderBlock(block());
        act(() => toggle().click());
        act(() => updateSignalAtPath(testState(), `${MODES}.m1.spd`, "1d5"));
        expect(field("m1", "spd").classList.contains("invalid")).toBe(true);
        expect(mode("m1").querySelector('[data-id="spdValue"]')!.textContent).toBe("—");
        expect($<HTMLInputElement>(`[data-id="modes.items.m1"] [data-id="half"]`)!.value).toBe("—");
    });

    it("adds an empty mode with the rules' multipliers and puts the caret into its name", async () => {
        const actions = recordingActions();
        rendered = renderBlock(block(), { actions });
        act(() => toggle().click());
        const add = dropdown()!.querySelector<HTMLButtonElement>(".add-button")!;
        expect(add.textContent).toBe("＋ Add mode");
        act(() => add.click());
        const created = actions.sent.at(-1) as { path: string; itemId: string; init: object };
        expect(created).toMatchObject({ type: "createItem", path: `${MODES}`, itemPos: pos(0, 1) });
        expect(created.itemId).toMatch(/^mode-/);
        await act(async () => { await flush(); });
        expect(document.activeElement).toBe(field(created.itemId, "name"));
        expect(field(created.itemId, "spd").value).toBe("");
        expect(["halfMult", "fullMult", "chargeMult", "runMult"].map(m => field(created.itemId, m).value)).toEqual(["1", "2", "3", "6"]);
        expect($(`[data-id="modes.items.${created.itemId}"] [data-id="half"]`)!.value).toBe("—");
    });

    it("suggests the SPD the traits give, Flyer's in place of the whole expression", () => {
        rendered = renderBlock(block());
        act(() => toggle().click());
        const input = field("m1", "spd");
        act(() => input.focus());
        expect(options().slice(0, 2)).toEqual(["8 — Flyer (8), size ignored", "+2 — Digitigrade (2), on foot"]);
        key(input, "ArrowDown");
        key(input, "Enter");
        expect(value(`${MODES}.m1.spd`)).toBe("8");
    });

    it("adds Digitigrade's number as a term and offers Size with its value", () => {
        rendered = renderBlock(block());
        act(() => toggle().click());
        const input = field("m1", "spd");
        act(() => input.focus());
        key(input, "ArrowDown");
        key(input, "ArrowDown");
        key(input, "Enter");
        expect(value(`${MODES}.m1.spd`)).toBe("A.b+Size+2");
        type(input, "A.b+si");
        expect(options()).toEqual(["Size — size of the character = 1"]);
    });

    it("suggests the names of modes, those of the traits first", () => {
        rendered = renderBlock(block());
        act(() => toggle().click());
        act(() => field("m1", "name").focus());
        expect(options()).toEqual(["Flight — from traits", "Move", "Hover", "Burrow", "Swim", "Climb"]);
    });
});
