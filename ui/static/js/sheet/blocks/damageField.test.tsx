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
                                    items: { d1: { expr: "S.b", enabled: true }, d2: { expr: "½WS.b", enabled: false } },
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
const toggle = () => $<HTMLButtonElement>('.panel[data-id="t1"] .damage-toggle')!;
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
        expect($('[data-id="r1"] [data-id="damageTotal"]')!.value).toBe("1d10+5");

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
        expect(toggle().classList.contains("active")).toBe(true);
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

        act(() => toggle().click());
        expect(dropdown()).not.toBeNull();
        act(() => toggle().click());
        expect(dropdown()).toBeNull();
    });

    it("adds a modifier that counts once its expression reads", () => {
        const actions = recordingActions();
        rendered = renderBlock(<MeleeAttacks />, { actions });
        act(() => toggle().click());
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
        act(() => toggle().click());
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
        act(() => toggle().click());
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
        act(() => toggle().click());
        expect(dropdown()!.querySelector(".damage-note")).not.toBeNull();
    });
});

describe("copying the modifiers of another weapon", () => {
    const copy = () => dropdown()!.querySelector<HTMLSelectElement>("select.damage-copy")!;
    const R1 = "rangedAttacks.list.items.r1";

    beforeEach(() => {
        const c = content();
        Object.assign(c.rangedAttacks.list.items.r1, {
            damageMods: { items: { x1: { expr: "1d5", enabled: true } }, layouts: { x1: pos(0, 0) } },
        });
        Object.assign(c.meleeAttacks.list.items.m1.tabs.items, { t2: { profile: "no", damage: "1d5" } });
        c.meleeAttacks.list.items.m1.tabs.layouts = { t1: pos(0, 0), t2: pos(0, 1) } as typeof c.meleeAttacks.list.items.m1.tabs.layouts;
        loadState(c);
        attachComputeds(characterState);
    });

    it("lists the other weapons with modifiers by group", () => {
        rendered = renderBlock(<MeleeAttacks />);
        act(() => toggle().click());
        const groups = Array.from(copy().querySelectorAll("optgroup"), g => [g.label, Array.from(g.children, o => o.textContent)]);
        // Not the profile itself, nor t2, which has none.
        expect(groups).toEqual([["Ranged", ["Bolter: 1d5"]]]);
        expect(copy().value).toBe("");
    });

    it("says in the list when no other weapon has modifiers", () => {
        const c = content();
        c.meleeAttacks.list.items.m1.tabs.items.t1.damageMods = { items: {}, layouts: {} } as unknown as typeof c.meleeAttacks.list.items.m1.tabs.items.t1.damageMods;
        loadState(c);
        attachComputeds(characterState);
        rendered = renderBlock(<MeleeAttacks />);
        act(() => toggle().click());
        expect(copy().disabled).toBe(false);
        expect(Array.from(copy().options, o => [o.textContent, o.disabled])).toEqual([["Copy from…", false], ["No other weapon has modifiers", true]]);
    });

    it("replaces the modifiers with those of the picked weapon under new ids", () => {
        const actions = recordingActions();
        rendered = renderBlock(<><MeleeAttacks /><RangedAttacks /></>, { actions });
        const t2 = () => $<HTMLElement>('.panel[data-id="t2"]')!;
        act(() => t2().querySelector<HTMLButtonElement>(".damage-toggle")!.click());
        const select = t2().querySelector<HTMLSelectElement>("select.damage-copy")!;
        expect(Array.from(select.querySelectorAll("option"), o => o.textContent)).toEqual([
            "Copy from…", "Chainaxe, axe: S.b, ½WS.b", "Bolter: 1d5",
        ]);

        act(() => {
            select.value = `${T1}`;
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        const T2 = "meleeAttacks.list.items.m1.tabs.items.t2";
        const [msg] = actions.scheduled.at(-1)! as [{ type: string; path: string; changes: { damageMods: { items: object; layouts: object } } }, string];
        expect(msg).toMatchObject({ type: "batch", path: T2 });
        const [a, b] = Object.keys(msg.changes.damageMods.items);
        expect(msg.changes.damageMods).toEqual({
            items: { [a]: { expr: "S.b", enabled: true }, [b]: { expr: "½WS.b", enabled: false } },
            layouts: { [a]: pos(0, 0), [b]: pos(0, 1) },
        });
        expect(a).toMatch(/^damage-mod-/);
        expect(select.value).toBe("");
        // 1d5 + S.b 4.
        expect(t2().querySelector<HTMLInputElement>('[data-id="damageTotal"]')!.value).toBe("1d5+4");
        expect(value(`${R1}.damageMods.items.x1.expr`)).toBe("1d5");
    });
});
