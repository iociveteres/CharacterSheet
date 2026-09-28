import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import Sortable from "sortablejs";
import { conditionOf, flush, loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock, type Rendered, getDataPath } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { resetDragFreeze } from "../state/dragFreeze";
import { applyRemoteToState } from "../state/remote";
import { characterState } from "../state/state";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import type { RollDefaults } from "../current";
import { MeleeAttacks, RangedAttacks } from "./Attacks";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;

const aim = { selected: "no", no: 0, half: 10, full: 20 };
const target = { selected: "no", no: 0, torso: -10, leg: -15, arm: -20, head: -20, joint: -40, eyes: -50 };
const rangedRoll = {
    aim, target,
    range: { selected: "combat", melee: -20, pointBlank: 30, short: 10, combat: 0, long: -10, extreme: -30 },
    rof: { selected: "single", single: 10, short: 0, long: -10, suppression: -20 },
    extra1: { name: "", value: 0, enabled: false }, extra2: { name: "", value: 0, enabled: false },
    baseSelect: "BS",
};
const meleeRoll = {
    aim, target,
    base: { selected: "standard", standard: 10, charge: 20, full: 30, careful: -10, mounted: 20, free: 0 },
    stance: { selected: "standard", standard: 0, aggressive: 10, defensive: -10 },
    rof: { selected: "single", single: 0, quick: -10, lightning: -20 },
    extra1: { name: "", value: 0, enabled: false }, extra2: { name: "", value: 0, enabled: false },
    baseSelect: "WS",
};

const content = () => ({
    characteristics: { BS: { value: "40", unnatural: "4" }, WS: { value: "35" } },
    rangedAttacks: {
        list: {
            items: {
                r1: { name: "Bolter", class: "rifle", damage: "1d10+5", pen: "4", roll: { ...rangedRoll, aim: { ...aim, selected: "half" } } },
                r2: { name: "Old", description: "no roll" },
            },
            layouts: { r1: pos(0, 0), r2: pos(0, 1) },
        },
    },
    meleeAttacks: {
        list: {
            items: {
                m1: {
                    name: "Chainaxe", group: "chain",
                    shield: { ap: 2, defenseSectors: "T+A1", equipped: true },
                    tabs: {
                        items: { t1: { profile: "axe", damage: "1d10+4" }, t2: { profile: "no", damage: "1d5" } },
                        layouts: { t1: pos(0, 0), t2: pos(0, 1) },
                    },
                    roll: meleeRoll,
                },
            },
            layouts: { m1: pos(0, 0) },
        },
    },
});

const rollDefaults = { rangedAttack: rangedRoll, meleeAttack: meleeRoll, psychicPower: {}, techPower: {} } as RollDefaults;
const show = (...[block, options]: Parameters<typeof renderBlock>) => renderBlock(block, { rollDefaults, ...options });

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
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const item = (id: string) => $<HTMLElement>(`[data-id="${id}"]`);

function capture(type: "sheet:rollVersus" | "sheet:rollExact", run: () => void): unknown[] {
    const rolls: unknown[] = [];
    const listener = (e: Event) => rolls.push((e as CustomEvent).detail);
    document.addEventListener(type, listener);
    run();
    document.removeEventListener(type, listener);
    return rolls;
}

describe("RangedAttacks", () => {
    it("renders the attack and its roll at their state paths", () => {
        const warn = vi.spyOn(console, "warn");
        rendered = show(<RangedAttacks />);
        const r1 = item("r1");
        expect(r1.querySelector<HTMLSelectElement>('[data-id="class"]')!.value).toBe("rifle");
        const half = r1.querySelector<HTMLInputElement>('[data-id="aim"] input[type="radio"][value="half"]')!;
        expect(half.checked).toBe(true);
        expect(getDataPath(half)).toBe("rangedAttacks.list.items.r1.roll.aim.selected");
        expect(getDataPath(r1.querySelector('[data-id="range"] [data-id="pointBlank"]')!)).toBe("rangedAttacks.list.items.r1.roll.range.pointBlank");
        // BS 40 + half aim 10 + single shot 10.
        expect(r1.querySelector<HTMLInputElement>('[data-id="roll"] [data-id="total"]')!.value).toBe("60");
        // An attack saved without roll settings has no dropdown, as before.
        expect(item("r2").querySelector('[data-id="roll"]')).toBeNull();
        expect(warn).not.toHaveBeenCalled();

        act(() => updateSignalAtPath("rangedAttacks.list.items.r1.roll.rof.selected", "suppression"));
        expect(r1.querySelector<HTMLInputElement>('[data-id="roll"] [data-id="total"]')!.value).toBe("30");
    });

    it("counts the point-blank modifier, whose field is named pointBlank", () => {
        rendered = show(<RangedAttacks />);
        act(() => updateSignalAtPath("rangedAttacks.list.items.r1.roll.range.selected", "point-blank"));
        // BS 40 + half aim 10 + point-blank 30 + single shot 10.
        expect(item("r1").querySelector<HTMLInputElement>('[data-id="roll"] [data-id="total"]')!.value).toBe("90");
    });

    it("opens the roll from the name label and rolls with the chosen modifiers", async () => {
        rendered = show(<RangedAttacks />);
        const r1 = item("r1");
        const dropdown = r1.querySelector<HTMLElement>('[data-id="roll"]')!;
        act(() => r1.querySelector<HTMLElement>(".name label")!.click());
        expect(dropdown.classList.contains("visible")).toBe(true);

        act(() => {
            updateSignalAtPath("rangedAttacks.list.items.r1.roll.extra1.name", "Scope");
            updateSignalAtPath("rangedAttacks.list.items.r1.roll.extra1.enabled", true);
        });
        const rolls = capture("sheet:rollVersus", () => act(() => dropdown.querySelector<HTMLButtonElement>('[data-id="rollButton"]')!.click()));
        expect(rolls).toEqual([{ target: 60, bonusSuccesses: 2, label: "Bolter, half aim, Scope" }]);
        expect(dropdown.classList.contains("visible")).toBe(false);

        const damage = capture("sheet:rollExact", () => r1.querySelector<HTMLElement>(".damage label")!.click());
        expect(damage).toEqual([{ expression: "1d10+5", label: "Bolter" }]);

        act(() => r1.querySelector<HTMLElement>(".name label")!.click());
        await flush();
        act(() => document.body.click());
        expect(dropdown.classList.contains("visible")).toBe(false);
    });

    it("creates attacks with the default roll and autocompletes over a new one", () => {
        const autocomplete = recordingAutocomplete();
        const actions = recordingActions();
        rendered = show(<RangedAttacks />, { actions, autocomplete });

        act(() => $<HTMLButtonElement>("#ranged-attack .add-button").click());
        const created = actions.sent.at(-1) as { itemId: string; init: { roll: object } };
        expect(created.itemId).toMatch(/^ranged-attack-/);
        expect(created.init).toEqual({ roll: rangedRoll });
        expect(item(created.itemId).querySelector('[data-id="roll"] [data-id="total"]')).not.toBeNull();

        pickSuggestion(autocomplete, item("r1").querySelector<HTMLInputElement>('[data-id="name"]')!, { name: "Boltgun" });
        expect(actions.sent.at(-1)).toMatchObject({ type: "autocompleteApply", collection: "ranged", base: { roll: rangedRoll } });
    });

    it("shows the roll of an attack saved without one once autocomplete brings it", () => {
        rendered = show(<RangedAttacks />);
        act(() => applyRemoteToState({
            type: "autocompleteApplied", path: "rangedAttacks.list.items.r2", changes: { name: "Boltgun", roll: rangedRoll },
        }));
        const dropdown = item("r2").querySelector('[data-id="roll"]');
        expect(dropdown).not.toBeNull();
        // BS 40 + single shot 10.
        expect(dropdown!.querySelector<HTMLInputElement>('[data-id="total"]')!.value).toBe("50");
    });
});

describe("MeleeAttacks", () => {
    const M1 = "meleeAttacks.list.items.m1";

    it("renders profile tabs and the shield fields of a shield", () => {
        const warn = vi.spyOn(console, "warn");
        rendered = show(<MeleeAttacks />);
        const m1 = item("m1");
        const labels = Array.from(m1.querySelectorAll<HTMLElement>(".tabs > .tablabel"), l => l.dataset.id);
        expect(labels).toEqual(["t1", "t2"]);
        expect(m1.querySelector<HTMLInputElement>('.radiotab[id="t1"]')!.checked).toBe(true);
        expect(m1.querySelector<HTMLInputElement>('.radiotab[id="t1"]')!.name).toBe("m1");
        const profile = m1.querySelector<HTMLSelectElement>('.tablabel[data-id="t1"] [data-id="profile"]')!;
        expect(profile.value).toBe("axe");
        expect(getDataPath(profile)).toBe(`${M1}.tabs.items.t1.profile`);
        expect(m1.querySelector<HTMLInputElement>('.panel[data-id="t1"] [data-id="damageTotal"]')!.value).toBe("1d10+4");
        expect(m1.querySelector(".shield-fields")).toBeNull();
        // WS 35 + standard 10.
        expect(m1.querySelector<HTMLInputElement>('[data-id="roll"] [data-id="total"]')!.value).toBe("45");
        expect(warn).not.toHaveBeenCalled();

        act(() => updateSignalAtPath(`${M1}.group`, "primary (shield)"));
        expect(m1.querySelector<HTMLInputElement>('.shield-fields [data-id="ap"]')!.value).toBe("2");
        expect(getDataPath(m1.querySelector('.shield-fields [data-id="ap"]')!)).toBe(`${M1}.shield.ap`);
    });

    it("rolls with the chosen options, names them in the label and counts a column's default when none is chosen", () => {
        rendered = show(<MeleeAttacks />);
        const m1 = item("m1");
        const total = () => m1.querySelector<HTMLInputElement>('[data-id="roll"] [data-id="total"]')!.value;
        act(() => {
            updateSignalAtPath(`${M1}.roll.base.selected`, "full");
            updateSignalAtPath(`${M1}.roll.stance.selected`, "aggressive");
            updateSignalAtPath(`${M1}.roll.rof.selected`, "quick");
        });
        // WS 35 + full 30 + aggressive 10 + quick -10.
        expect(total()).toBe("65");

        act(() => m1.querySelector<HTMLElement>(".name label")!.click());
        const rolls = capture("sheet:rollVersus", () => act(() => m1.querySelector<HTMLButtonElement>('[data-id="rollButton"]')!.click()));
        expect(rolls).toEqual([{ target: 65, bonusSuccesses: 0, label: "Chainaxe, full attack, aggressive, quick attack" }]);

        // No base chosen counts the standard one.
        act(() => updateSignalAtPath(`${M1}.roll.base.selected`, ""));
        expect(total()).toBe("45");
    });

    it("rolls the damage of a profile with the profile's name", () => {
        rendered = show(<MeleeAttacks />);
        const damage = (tab: string) => item(tab).parentElement!
            .querySelector<HTMLElement>(`.panel[data-id="${tab}"] .damage label`)!;
        expect(capture("sheet:rollExact", () => damage("t1").click())).toEqual([{ expression: "1d10+4", label: "Chainaxe, axe" }]);
        expect(capture("sheet:rollExact", () => damage("t2").click())).toEqual([{ expression: "1d5", label: "Chainaxe" }]);
    });

    it("rolls the damage of a profile with its enabled modifiers at the characteristics of the moment", () => {
        const c = content();
        c.characteristics = { ...c.characteristics, S: { value: "42" } } as typeof c.characteristics;
        Object.assign(c.meleeAttacks.list.items.m1.tabs.items.t1, {
            damage: "1d10–2",
            damageMods: {
                items: {
                    d2: { expr: "½WS.b▼", name: "Crushing Blow", enabled: true },
                    d1: { expr: "S.b", enabled: true },
                    d3: { expr: "1d10", enabled: false },
                },
                layouts: { d1: pos(0, 0), d2: pos(0, 1), d3: pos(0, 2) },
            },
        });
        loadState(c);
        attachComputeds(characterState);
        rendered = show(<MeleeAttacks />);
        const damage = () => item("t1").parentElement!.querySelector<HTMLElement>('.panel[data-id="t1"] .damage label')!;

        // 1d10 − 2 + S.b 4 + ½ × WS.b 3, rounded down.
        expect(capture("sheet:rollExact", () => damage().click())).toEqual([
            { expression: "1d10+3", label: "Chainaxe, axe (S.b +4, Crushing Blow +1)" },
        ]);

        act(() => {
            updateSignalAtPath("characteristics.S.value", "55");
            updateSignalAtPath(`${M1}.tabs.items.t1.damageMods.items.d3.enabled`, true);
        });
        expect(capture("sheet:rollExact", () => damage().click())).toEqual([
            { expression: "2d10+4", label: "Chainaxe, axe (S.b +5, Crushing Blow +1, 1d10 +1d10)" },
        ]);
    });

    it("adds, deletes and replaces profile tabs", () => {
        const actions = recordingActions();
        rendered = show(<MeleeAttacks />, { actions });
        const m1 = item("m1");
        const labels = () => Array.from(m1.querySelectorAll<HTMLElement>(".tabs > .tablabel"), l => l.dataset.id);

        act(() => m1.querySelector<HTMLButtonElement>(".add-tab-btn")!.click());
        const created = actions.sent.at(-1) as { path: string; itemId: string; itemPos: object };
        expect(created).toMatchObject({ type: "createItem", path: `${M1}.tabs.items`, itemPos: pos(0, 2) });
        expect(labels()).toEqual(["t1", "t2", created.itemId]);
        // A new tab opens and has the "Other" profile.
        expect(m1.querySelector<HTMLInputElement>(`.radiotab[id="${created.itemId}"]`)!.checked).toBe(true);
        expect(value(`${M1}.tabs.items.${created.itemId}.profile`)).toBe("");

        act(() => m1.querySelector<HTMLButtonElement>(`.tablabel[data-id="${created.itemId}"] .delete-button`)!.click());
        expect(actions.sent.at(-1)).toEqual({ type: "deleteItem", path: `${M1}.tabs.items.${created.itemId}` });
        expect(m1.querySelector<HTMLInputElement>('.radiotab[id="t2"]')!.checked).toBe(true);

        // Autocomplete brings the profiles of the weapon; the first one opens.
        act(() => {
            applyRemoteToState({
                type: "autocompleteApplied", path: M1,
                changes: { name: "Power Sword", group: "power", roll: meleeRoll, tabs: { items: { x1: { profile: "sword", damage: "1d10+5" } } } },
            });
        });
        expect(labels()).toEqual(["x1"]);
        expect(m1.querySelector<HTMLInputElement>('.radiotab[id="x1"]')!.checked).toBe(true);
        expect(m1.querySelector<HTMLInputElement>('.panel[data-id="x1"] [data-id="damageTotal"]')!.value).toBe("1d10+5");
    });

    it("creates a melee attack with one Mace profile", () => {
        const actions = recordingActions();
        rendered = show(<MeleeAttacks />, { actions });
        act(() => $<HTMLButtonElement>("#melee-attack .add-button").click());
        const { itemId, init } = actions.sent.at(-1) as { itemId: string; init: { tabs: { items: object }; roll: object } };
        const [tab] = Object.keys(init.tabs.items);
        expect(init).toEqual({ roll: meleeRoll, tabs: { items: { [tab]: { profile: "mace" } }, layouts: { [tab]: pos(0, 0) } } });
        expect(item(itemId).querySelector<HTMLSelectElement>('.tablabel [data-id="profile"]')!.value).toBe("mace");
    });

    it("sorts the profile tabs by dragging their labels", () => {
        const actions = recordingActions();
        rendered = show(<MeleeAttacks />, { actions });
        const tabs = item("m1").querySelector<HTMLElement>(".tabs")!;
        const options = Sortable.get(tabs)!.options as Required<Sortable.Options>;
        expect(options.draggable).toBe(".tablabel");
        const t2 = tabs.querySelector<HTMLElement>('.tablabel[data-id="t2"]')!;

        act(() => options.onStart({ item: t2 } as unknown as Sortable.SortableEvent));
        // What Sortable does: t2 goes before t1's label.
        tabs.insertBefore(t2, tabs.querySelector('.tablabel[data-id="t1"]'));
        act(() => options.onEnd({ item: t2 } as unknown as Sortable.SortableEvent));

        expect(actions.scheduled.at(-1)![0]).toEqual({
            type: "positionsChanged", path: "meleeAttacks.list.items.m1.tabs.items", positions: { t2: pos(0, 0), t1: pos(0, 1) },
        });
        // Radio, label and panel of a tab stay together.
        expect(Array.from(tabs.children, el => `${el.className.split(" ")[0]}:${(el as HTMLElement).dataset.id ?? el.id}`)).toEqual([
            "radiotab:t2", "tablabel:t2", "panel:t2", "radiotab:t1", "tablabel:t1", "panel:t1", "add-tab-btn:",
        ]);
    });
});

describe("a roll bonus limited to attacks", () => {
    const total = (id: string) => item(id).querySelector<HTMLInputElement>('[data-id="roll"] [data-id="total"]')!.value;

    it("counts a melee bonus on Any in melee attacks only", () => {
        loadState({ ...content(), conditions: conditionOf({ type: "roll_bonus", name: "Any", rollBonus: "10", domainMode: "only", domains: { melee: true } }) });
        attachComputeds(characterState);
        rendered = show(<><MeleeAttacks /><RangedAttacks /></>);

        // WS 35 + standard 10 + 10.
        expect(total("m1")).toBe("55");
        // BS 40 + half aim 10 + single 10.
        expect(total("r1")).toBe("60");
        expect(value("characteristics.WS.valueForRolls")).toBe(35);

        // Whatever the attack is tested on.
        act(() => updateSignalAtPath("meleeAttacks.list.items.m1.roll.baseSelect", "BS"));
        expect(total("m1")).toBe("60");
    });

    it("counts a named bonus except ranged attacks everywhere but in them", () => {
        loadState({ ...content(), conditions: conditionOf({ type: "roll_bonus", name: "BS", rollBonus: "-20", domainMode: "except", domains: { ranged: true } }) });
        attachComputeds(characterState);
        rendered = show(<><MeleeAttacks /><RangedAttacks /></>);

        expect(total("r1")).toBe("60");
        expect(value("characteristics.BS.valueForRolls")).toBe(20);
        act(() => updateSignalAtPath("meleeAttacks.list.items.m1.roll.baseSelect", "BS"));
        expect(total("m1")).toBe("30");
    });
});
