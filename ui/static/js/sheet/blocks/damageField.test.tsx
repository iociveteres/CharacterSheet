import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { flush, loadState, recordingActions, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { resetDragFreeze } from "../state/dragFreeze";
import { characterState } from "../state/state";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import { MeleeAttacks, RangedAttacks } from "./Attacks";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;

const T1 = "meleeAttacks.list.items.m1.tabs.items.t1";

const content = () => ({
    characteristics: { S: { value: "42" }, WS: { value: "35" }, BS: { value: "30" } },
    psykana: { basePR: 3 },
    rangedAttacks: {
        list: { items: { r1: { name: "Bolter", damage: "1d10+5" } }, layouts: { r1: pos(0, 0) } },
    },
    meleeAttacks: {
        list: {
            items: {
                m1: {
                    name: "Chainaxe",
                    tabs: {
                        items: {
                            t1: {
                                profile: "axe", damage: "1d10+2",
                                damageMods: {
                                    items: { d1: { expr: "S.b", enabled: true }, d2: { expr: "½WS.b", name: "Crushing Blow", enabled: false } },
                                    layouts: { d1: pos(0, 0), d2: pos(0, 1) },
                                },
                            },
                        },
                        layouts: { t1: pos(0, 0) },
                    },
                },
            },
            layouts: { m1: pos(0, 0) },
        },
    },
});

let rendered: Rendered | null = null;

beforeEach(() => {
    loadState(content());
    attachComputeds(characterState);
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
const panel = (sel: string) => $(`.panel[data-id="t1"] ${sel}`);
const total = () => panel('[data-id="damageTotal"]')!;
const dropdown = () => $<HTMLElement>('.panel[data-id="t1"] .damage-dropdown');
const gear = () => $<HTMLButtonElement>('.panel[data-id="t1"] .damage-mods-toggle')!;
const mod = (id: string) => $<HTMLElement>(`.damage-mods [data-id="${id}"]`)!;
const expr = (id: string) => mod(id).querySelector<HTMLInputElement>('[data-id="expr"]')!;
const options = () => Array.from(rendered!.container.querySelectorAll(".damage-dropdown .autocomplete-option"), el => el.textContent);
const type = (input: HTMLInputElement, text: string) => act(() => {
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));
});
const key = (input: HTMLInputElement, k: string) => act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

describe("the damage of an attack", () => {
    it("shows the damage with the enabled modifiers, following the characteristics", () => {
        rendered = renderBlock(<><MeleeAttacks /><RangedAttacks /></>);
        // 1d10 + 2 + S.b 4.
        expect(total().value).toBe("1d10+6");
        expect(total().readOnly).toBe(true);
        expect(total().title).toBe("Weapon 1d10+2\nS.b +4");
        expect(gear().classList.contains("has-mods")).toBe(true);
        expect($('[data-id="r1"] [data-id="damageTotal"]')!.value).toBe("1d10+5");
        expect($<HTMLElement>('[data-id="r1"] .damage-mods-toggle')!.classList.contains("has-mods")).toBe(false);

        act(() => {
            updateSignalAtPath("characteristics.S.value", "51");
            updateSignalAtPath(`${T1}.damageMods.items.d2.enabled`, true);
        });
        // S.b 5 + ½ × WS.b 3, rounded down.
        expect(total().value).toBe("1d10+8");
    });

    it("opens the dropdown at the weapon's own damage on a click of the total", async () => {
        const actions = recordingActions();
        rendered = renderBlock(<MeleeAttacks />, { actions });
        expect(dropdown()).toBeNull();

        act(() => total().click());
        expect(dropdown()).not.toBeNull();
        expect(gear().classList.contains("active")).toBe(true);
        const base = dropdown()!.querySelector<HTMLInputElement>('[data-id="damage"]')!;
        expect(base.value).toBe("1d10+2");
        expect(document.activeElement).toBe(base);

        type(base, "2d10");
        expect(actions.scheduled.at(-1)![0]).toEqual({ type: "change", path: `${T1}.damage`, change: "2d10" });
        expect(total().value).toBe("2d10+4");
        expect(dropdown()!.querySelector('[data-id="result"]')!.textContent).toBe("2d10+4");

        await flush();
        act(() => document.body.click());
        expect(dropdown()).toBeNull();

        act(() => gear().click());
        expect(dropdown()).not.toBeNull();
        act(() => gear().click());
        expect(dropdown()).toBeNull();
    });

    it("adds a modifier that counts once its expression reads", () => {
        const actions = recordingActions();
        rendered = renderBlock(<MeleeAttacks />, { actions });
        act(() => gear().click());
        expect(mod("d1").querySelector('[data-id="added"]')!.textContent).toBe("+4");
        expect(mod("d2").classList.contains("disabled")).toBe(true);

        act(() => dropdown()!.querySelector<HTMLButtonElement>(".add-button")!.click());
        const created = actions.sent.at(-1) as { path: string; itemId: string; init: object };
        expect(created).toMatchObject({ type: "createItem", path: `${T1}.damageMods.items`, init: { enabled: true }, itemPos: pos(0, 2) });
        expect(created.itemId).toMatch(/^damage-mod-/);
        const added = mod(created.itemId).querySelector('[data-id="added"]')!;
        expect(added.textContent).toBe("—");

        type(expr(created.itemId), "1d10+1");
        expect(added.textContent).toBe("+1d10+1");
        expect(total().value).toBe("2d10+7");
    });

    it("completes the term being typed with a picked reference", () => {
        rendered = renderBlock(<MeleeAttacks />);
        act(() => gear().click());
        const input = expr("d2");
        act(() => input.focus());
        expect(options()).toContain("S.b — Strength bonus = 4");

        type(input, "½WS.b+bp");
        expect(options()).toEqual(["bPR — base psy rating = 3"]);
        key(input, "ArrowDown");
        key(input, "Enter");
        expect(value(`${T1}.damageMods.items.d2.expr`)).toBe("½WS.b+bPR");
    });

    it("marks a term that reads as nothing and leaves the modifier out", () => {
        rendered = renderBlock(<MeleeAttacks />);
        act(() => gear().click());
        act(() => updateSignalAtPath(`${T1}.damageMods.items.d1.expr`, "S.b + Ag.b"));
        expect(expr("d1").classList.contains("invalid")).toBe(true);
        expect(expr("d1").title).toMatch(/^Unknown: Ag\.b\. /);
        expect(Array.from(mod("d1").querySelectorAll(".text-marks mark"), m => m.textContent)).toEqual(["Ag.b"]);
        expect(mod("d1").querySelector('[data-id="added"]')!.textContent).toBe("—");
        expect(total().value).toBe("1d10+2");
    });

    it("says why the modifiers do not count on damage that is no expression", () => {
        rendered = renderBlock(<MeleeAttacks />);
        act(() => updateSignalAtPath(`${T1}.damage`, "Нет"));
        expect(total().value).toBe("Нет");
        act(() => gear().click());
        expect(dropdown()!.querySelector(".damage-note")).not.toBeNull();
    });
});
