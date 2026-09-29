import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { resetDragFreeze } from "../state/dragFreeze";
import { characterState } from "../state/state";
import { valueAt } from "../state/sync";
import { resetUiState } from "../state/ui";
import { TechnoArcana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

let rendered: Rendered | null = null;

beforeEach(() => {
    loadState({
        characteristics: { I: { value: "45" } },
        cybernetics: { list: { items: { c1: { name: "Explorator" }, c2: { name: "Abeyant" } }, layouts: { c1: pos(0, 0), c2: pos(1, 0) } } },
        talents: { list: { items: { t1: { name: "Virtual Memory" } }, layouts: { t1: pos(0, 0) } } },
        technoArcana: {
            cognitionMax: { base: "12" },
            energyMax: { mods: { items: { m1: { name: "Virtual Memory", expr: "2", enabled: true } }, layouts: { m1: pos(0, 0) } } },
        },
    });
    attachComputeds(characterState);
    rendered = renderBlock(<TechnoArcana />);
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    resetDragFreeze();
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const total = (stat: string) => $(`[data-id="${stat}Total"]`)!;
const open = (stat: string) => act(() => $<HTMLButtonElement>(`.resource-stat:has([data-id="${stat}Total"]) .mod-toggle`)!.click());
const type = (input: HTMLInputElement, value: string) => act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("the cognition and energy stats of Techno Arcana", () => {
    it("show their totals, by the rules while the base is empty, and explain them", () => {
        expect([total("cognitionMax").value, total("cognitionRestore").value, total("energyMax").value, total("energyRestore").value])
            .toEqual(["12", "2", "5", "0"]);
        expect(total("cognitionMax").title).toBe("Base 12 = 12");
        expect(total("energyMax").title).toBe("By the rules 3 = 3\nVirtual Memory +2");
    });

    it("take a base and named modifiers in the dropdown", () => {
        open("cognitionRestore");
        const dropdown = $<HTMLElement>('[data-id="cognitionRestore"]')!;
        const base = dropdown.querySelector<HTMLInputElement>('[data-id="base"]')!;
        expect(base.placeholder).toBe("½I.b▲");
        expect(dropdown.querySelector('[data-id="rule"]')!.textContent).toBe("By the rules: ½I.b▲ ⚙ a turn");

        type(base, "I.b");
        expect(valueAt("technoArcana.cognitionRestore.base")).toBe("I.b");
        expect(total("cognitionRestore").value).toBe("4");

        act(() => dropdown.querySelector<HTMLButtonElement>(".add-button")!.click());
        const row = dropdown.querySelector<HTMLElement>(".resource-mod")!;
        type(row.querySelector<HTMLInputElement>('[data-id="expr"]')!, "-1");
        expect(row.querySelector('[data-id="added"]')!.textContent).toBe("-1");
        expect(total("cognitionRestore").value).toBe("3");
    });

    it("suggest characteristic bonuses for the expression of a modifier, but no dice", () => {
        open("energyMax");
        const expr = $('[data-id="energyMax"] .resource-mod [data-id="expr"]')!;
        type(expr, "I");
        const groups = Array.from(document.querySelectorAll(".autocomplete-group"), g => g.textContent);
        expect(groups).toEqual(["Characteristic bonus", "With a factor"]);
        const option = Array.from(document.querySelectorAll<HTMLElement>(".autocomplete-option")).find(o => o.textContent!.startsWith("I.b"))!;
        expect(option.textContent).toBe("I.b — Intellig. bonus = 4");

        type(expr, "½I.b");
        expect(document.querySelector(".autocomplete-group")!.textContent).toBe("Rounding");
        act(() => { document.querySelector(".autocomplete-option")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
        expect(valueAt("technoArcana.energyMax.mods.items.m1.expr")).toBe("½I.b▲");
        expect(total("energyMax").value).toBe("5");
    });

    it("suggest the implants and talents of the sheet as the source of a modifier", () => {
        open("energyMax");
        const name = $('[data-id="energyMax"] .resource-mod [data-id="name"]')!;
        act(() => { name.dispatchEvent(new FocusEvent("focus")); });
        const groups = Array.from(document.querySelectorAll(".autocomplete-group"), g => g.textContent);
        const options = Array.from(document.querySelectorAll(".autocomplete-option"), o => o.textContent);
        expect(groups).toEqual(["Cybernetics", "Talents"]);
        expect(options).toEqual(["Explorator", "Abeyant", "Virtual Memory"]);
    });
});
