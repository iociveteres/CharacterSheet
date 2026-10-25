import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { hoverLines, loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { resolvePath } from "../state/sync";
import { MeleeAttacks } from "./Attacks";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;
const M1 = "meleeAttacks.list.items.m1";

/** A Longsword of two profiles, sword and axe. */
const content = (attack: object = {}) => ({
    characteristics: { S: { value: "40" }, WS: { value: "45" } },
    meleeAttacks: {
        list: {
            items: {
                m1: {
                    name: "Longsword", grip: "2р [1р, Бл, Мх, 1р+Кл]", balance: "2",
                    tabs: {
                        items: {
                            t1: { profile: "sword", range: "2-5", damage: "1d10+2", pen: "0", damageType: "R", special: "Primitive" },
                            t2: { profile: "axe", range: "2-4", damage: "1d10", pen: "0" },
                        },
                        layouts: { t1: pos(0, 0), t2: pos(0, 1) },
                    },
                    ...attack,
                },
            },
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
const chips = () => Array.from(rendered!.container.querySelectorAll<HTMLButtonElement>(".grip-chip"));
const chip = (id: string) => chips().find(c => c.textContent === id)!;
const selected = () => chips().filter(c => c.classList.contains("selected")).map(c => c.textContent);
const t1 = (sel: string) => $(`.panel[data-id="t1"] ${sel}`)!;
const key = (input: HTMLInputElement, k: string) => act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

describe("the grips of a melee weapon", () => {
    it("shows the grips in English, the primary held", () => {
        rendered = renderBlock(<MeleeAttacks />);
        expect(chips().map(c => c.textContent)).toEqual(["2h", "1h", "Cl", "Mh", "1h+Fist"]);
        expect(selected()).toEqual(["2h"]);
        expect(chip("Cl").title).toContain("Close: Rng −2");
    });

    it("holds a grip on a click, the primary as none", () => {
        rendered = renderBlock(<MeleeAttacks />);
        act(() => chip("Cl").click());
        expect(value(`${M1}.gripSelected`)).toBe("Cl");
        expect(selected()).toEqual(["Cl"]);
        expect(t1('[data-id="rangeTotal"]').value).toBe("0-3");
        expect($('[data-id="balanceTotal"]')!.value).toBe("-2");
        expect(t1('[data-id="addedProperties"]').textContent).toBe("+ Precise");

        act(() => chip("2h").click());
        expect(value(`${M1}.gripSelected`)).toBe("");
        expect(t1('[data-id="addedProperties"]')).toBeNull();
    });

    it("edits the grip string in place: Enter keeps it, Esc puts it back", () => {
        rendered = renderBlock(<MeleeAttacks />);
        act(() => $<HTMLButtonElement>(".grip-edit")!.click());
        const input = $('.grip [data-id="grip"]')!;
        expect(input.value).toBe("2р [1р, Бл, Мх, 1р+Кл]");
        act(() => {
            input.value = "2h [Rev]";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        key(input, "Enter");
        expect(chips().map(c => c.textContent)).toEqual(["2h", "Rev"]);

        act(() => $<HTMLButtonElement>(".grip-edit")!.click());
        const again = $('.grip [data-id="grip"]')!;
        act(() => {
            again.value = "nonsense";
            again.dispatchEvent(new Event("input", { bubbles: true }));
        });
        key(again, "Escape");
        expect(value(`${M1}.grip`)).toBe("2h [Rev]");
        expect(chips().map(c => c.textContent)).toEqual(["2h", "Rev"]);
    });

    it("shows Range and Balance as totals whose ⚙ breaks them down", () => {
        loadState(content({ gripSelected: "1h" }));
        attachComputeds(testState());
        rendered = renderBlock(<MeleeAttacks />);
        const range = t1('[data-id="rangeTotal"]');
        expect(range.value).toBe("3-6");
        expect(range.title.split("\n")).toEqual(["2-5 Weapon", "+1 1h", "= 3-6"]);

        act(() => range.click());
        const window = t1(".range .mod-dropdown");
        expect(window.classList.contains("open-right")).toBe(true);
        expect(window.querySelector<HTMLInputElement>('[data-id="range"]')!.value).toBe("2-5");
        expect(Array.from(window.querySelectorAll(".breakdown span"), s => s.textContent)).toEqual(["+1", "1h", "3-6", ""]);

        act(() => $<HTMLButtonElement>(".balance .mod-toggle")!.click());
        expect(Array.from($(".balance .mod-dropdown")!.querySelectorAll(".breakdown span"), s => s.textContent)).toEqual(["-1", "1h", "1", ""]);
    });

    it("counts the grip in the damage breakdown", () => {
        loadState(content({ gripSelected: "1h" }));
        attachComputeds(testState());
        rendered = renderBlock(<MeleeAttacks />);
        const damage = t1('[data-id="damageTotal"]');
        expect(damage.value).toBe("1d10-2");
        expect(hoverLines(damage)).toEqual(["Weapon 1d10+2", "1h -4"]);
    });

    it("shows the one-handed Mace's profile in Mordhau", () => {
        loadState(content({ gripSelected: "Mh" }));
        attachComputeds(testState());
        rendered = renderBlock(<MeleeAttacks />);
        expect($<HTMLSelectElement>('.tablabel[data-id="t1"] select')!.value).toBe("Mace");
        expect(t1('[data-id="rangeTotal"]').value).toBe("3");
        expect(t1('[data-id="damageTotal"]').value).toBe("1d10+4");
        expect(t1(".damage-type select").textContent).toBe("I(Cr)");
        expect(t1(".special input").value).toBe("Imprecise, Primitive");
        expect($('[data-id="balanceTotal"]')!.value).toBe("-1");
    });

    it("dims the profile tabs the Fist grip does not use", () => {
        loadState(content({ gripSelected: "1h+Fist" }));
        attachComputeds(testState());
        rendered = renderBlock(<MeleeAttacks />);
        const sword = $<HTMLSelectElement>('.tablabel[data-id="t1"] select')!;
        const axe = $<HTMLSelectElement>('.tablabel[data-id="t2"] select')!;
        expect(sword.classList.contains("dimmed")).toBe(true);
        expect(sword.title).toBe("1h+Fist uses only the axe, hook, hammer profiles");
        expect(axe.classList.contains("dimmed")).toBe(false);
        // Still a profile to pick.
        expect(sword.disabled).toBe(false);
    });
});
