import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import Sortable from "sortablejs";
import { applyRemote, conditionOf, flush, getDataPath, loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock, rollOf, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import type { RollDefaults } from "../payload";
import { MeleeAttacks, RangedAttacks } from "./Attacks";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;

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
    attachComputeds(testState());
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const item = (id: string) => $<HTMLElement>(`[data-id="${id}"]`);

function capture(type: "sheet:rollVersus" | "sheet:rollExact", run: () => void): unknown[] {
    const rolls: unknown[] = [];
    const listener = (e: Event) => rolls.push(rollOf((e as CustomEvent).detail));
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

        act(() => updateSignalAtPath(testState(), "rangedAttacks.list.items.r1.roll.rof.selected", "suppression"));
        expect(r1.querySelector<HTMLInputElement>('[data-id="roll"] [data-id="total"]')!.value).toBe("30");
    });

    it("counts the point-blank modifier, whose field is named pointBlank", () => {
        rendered = show(<RangedAttacks />);
        act(() => updateSignalAtPath(testState(), "rangedAttacks.list.items.r1.roll.range.selected", "point-blank"));
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
            updateSignalAtPath(testState(), "rangedAttacks.list.items.r1.roll.extra1.name", "Scope");
            updateSignalAtPath(testState(), "rangedAttacks.list.items.r1.roll.extra1.enabled", true);
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
        act(() => applyRemote({
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

        act(() => updateSignalAtPath(testState(), `${M1}.group`, "primary (shield)"));
        expect(m1.querySelector<HTMLInputElement>('.shield-fields [data-id="ap"]')!.value).toBe("2");
        expect(getDataPath(m1.querySelector('.shield-fields [data-id="ap"]')!)).toBe(`${M1}.shield.ap`);
    });

    it("rolls with the chosen options, names them in the label and counts a column's default when none is chosen", () => {
        rendered = show(<MeleeAttacks />);
        const m1 = item("m1");
        const total = () => m1.querySelector<HTMLInputElement>('[data-id="roll"] [data-id="total"]')!.value;
        act(() => {
            updateSignalAtPath(testState(), `${M1}.roll.base.selected`, "full");
            updateSignalAtPath(testState(), `${M1}.roll.stance.selected`, "aggressive");
            updateSignalAtPath(testState(), `${M1}.roll.rof.selected`, "quick");
        });
        // WS 35 + full 30 + aggressive 10 + quick -10.
        expect(total()).toBe("65");

        act(() => m1.querySelector<HTMLElement>(".name label")!.click());
        const rolls = capture("sheet:rollVersus", () => act(() => m1.querySelector<HTMLButtonElement>('[data-id="rollButton"]')!.click()));
        expect(rolls).toEqual([{ target: 65, bonusSuccesses: 0, label: "Chainaxe, full attack, aggressive, quick attack" }]);

        // No base chosen counts the standard one.
        act(() => updateSignalAtPath(testState(), `${M1}.roll.base.selected`, ""));
        expect(total()).toBe("45");
    });

    it("rolls the damage of a profile with the profile's name", () => {
        rendered = show(<MeleeAttacks />);
        const damage = (tab: string) => item(tab).parentElement!
            .querySelector<HTMLElement>(`.panel[data-id="${tab}"] .damage label`)!;
        expect(capture("sheet:rollExact", () => damage("t1").click())).toEqual([{ expression: "1d10+4", label: "Chainaxe, axe" }]);
        expect(capture("sheet:rollExact", () => damage("t2").click())).toEqual([{ expression: "1d5", label: "Chainaxe" }]);
    });

    it("rolls the damage of a profile with its enabled modifiers at the characteristics of the moment, labelled by the profile", () => {
        const c = content();
        c.characteristics = { ...c.characteristics, S: { value: "42" } } as typeof c.characteristics;
        Object.assign(c.meleeAttacks.list.items.m1.tabs.items.t1, {
            damage: "1d10–2",
            damageMods: {
                items: {
                    d2: { expr: "½WS.b▼", enabled: true },
                    d1: { expr: "S.b", enabled: true },
                    d3: { expr: "1d10", enabled: false },
                },
                layouts: { d1: pos(0, 0), d2: pos(0, 1), d3: pos(0, 2) },
            },
        });
        loadState(c);
        attachComputeds(testState());
        rendered = show(<MeleeAttacks />);
        const damage = () => item("t1").parentElement!.querySelector<HTMLElement>('.panel[data-id="t1"] .damage label')!;

        // 1d10 − 2 + S.b 4 + ½ × WS.b 3, rounded down.
        expect(capture("sheet:rollExact", () => damage().click())).toEqual([
            { expression: "1d10+3", label: "Chainaxe, axe" },
        ]);

        act(() => {
            updateSignalAtPath(testState(), "characteristics.S.value", "55");
            updateSignalAtPath(testState(), `${M1}.tabs.items.t1.damageMods.items.d3.enabled`, true);
        });
        expect(capture("sheet:rollExact", () => damage().click())).toEqual([
            { expression: "2d10+4", label: "Chainaxe, axe" },
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
            applyRemote({
                type: "autocompleteApplied", path: M1,
                changes: { name: "Power Sword", group: "power", roll: meleeRoll, tabs: { items: { x1: { profile: "sword", damage: "1d10+5" } } } },
            });
        });
        expect(labels()).toEqual(["x1"]);
        expect(m1.querySelector<HTMLInputElement>('.radiotab[id="x1"]')!.checked).toBe(true);
        expect(m1.querySelector<HTMLInputElement>('.panel[data-id="x1"] [data-id="damageTotal"]')!.value).toBe("1d10+5");
    });

    /** The one modifier id of a damageMods grid of a sent init, checked to be as the grid places it. */
    const onlyMod = (grid: { items: object; layouts: object }) => {
        const [id] = Object.keys(grid.items);
        expect(id).toMatch(/^damage-mod-/);
        expect(grid.layouts).toEqual({ [id]: pos(0, 0) });
        return id;
    };

    it("creates a melee attack with one Mace profile that adds the Strength bonus", () => {
        const actions = recordingActions();
        rendered = show(<MeleeAttacks />, { actions });
        act(() => $<HTMLButtonElement>("#melee-attack .add-button").click());
        type Init = { tabs: { items: { [id: string]: { damageMods: { items: object; layouts: object } } } }; roll: object };
        const { itemId, init } = actions.sent.at(-1) as { itemId: string; init: Init };
        const [tab] = Object.keys(init.tabs.items);
        const mod = onlyMod(init.tabs.items[tab].damageMods);
        expect(init).toEqual({
            roll: meleeRoll,
            tabs: {
                items: { [tab]: { profile: "mace", damageMods: { items: { [mod]: { expr: "S.b", enabled: true } }, layouts: { [mod]: pos(0, 0) } } } },
                layouts: { [tab]: pos(0, 0) },
            },
        });
        expect(item(itemId).querySelector<HTMLSelectElement>('.tablabel [data-id="profile"]')!.value).toBe("mace");
    });

    it("gives a new profile tab the modifiers of the first one, under new ids", () => {
        const c = content();
        Object.assign(c.meleeAttacks.list.items.m1.tabs.items.t2, {
            damageMods: { items: { d1: { expr: "S.b", enabled: true }, d2: { expr: "½WS.b", enabled: false } }, layouts: { d1: pos(0, 1), d2: pos(0, 0) } },
            penMods: { items: { p1: { expr: "2", enabled: true } }, layouts: { p1: pos(0, 0) } },
        });
        // t2 comes first.
        c.meleeAttacks.list.items.m1.tabs.layouts = { t1: pos(0, 1), t2: pos(0, 0) };
        loadState(c);
        attachComputeds(testState());
        const actions = recordingActions();
        rendered = show(<MeleeAttacks />, { actions });

        act(() => item("m1").querySelector<HTMLButtonElement>(".add-tab-btn")!.click());
        type Grid = { items: object; layouts: object };
        const { init } = actions.sent.at(-1) as { init: { damageMods: Grid; penMods: Grid } };
        const [first, second] = Object.keys(init.damageMods.items);
        const [pen] = Object.keys(init.penMods.items);
        expect(init).toEqual({
            damageMods: {
                items: { [first]: { expr: "½WS.b", enabled: false }, [second]: { expr: "S.b", enabled: true } },
                layouts: { [first]: pos(0, 0), [second]: pos(0, 1) },
            },
            penMods: { items: { [pen]: { expr: "2", enabled: true } }, layouts: { [pen]: pos(0, 0) } },
        });
        expect(first).toMatch(/^damage-mod-/);
        expect(pen).toMatch(/^pen-mod-/);
    });

    it("gives the Strength bonus to the profile tab of an attack with none left", () => {
        const c = content();
        c.meleeAttacks.list.items.m1.tabs = { items: {}, layouts: {} } as unknown as typeof c.meleeAttacks.list.items.m1.tabs;
        loadState(c);
        attachComputeds(testState());
        const actions = recordingActions();
        rendered = show(<MeleeAttacks />, { actions });

        act(() => item("m1").querySelector<HTMLButtonElement>(".add-tab-btn")!.click());
        const { init } = actions.sent.at(-1) as { init: { damageMods: { items: object; layouts: object } } };
        const mod = onlyMod(init.damageMods);
        expect(init.damageMods.items).toEqual({ [mod]: { expr: "S.b", enabled: true } });
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
        attachComputeds(testState());
        rendered = show(<><MeleeAttacks /><RangedAttacks /></>);

        // WS 35 + standard 10 + 10.
        expect(total("m1")).toBe("55");
        // BS 40 + half aim 10 + single 10.
        expect(total("r1")).toBe("60");
        expect(value("characteristics.WS.valueForRolls")).toBe(35);

        // Whatever the attack is tested on.
        act(() => updateSignalAtPath(testState(), "meleeAttacks.list.items.m1.roll.baseSelect", "BS"));
        expect(total("m1")).toBe("60");
    });

    it("counts a named bonus except ranged attacks everywhere but in them", () => {
        loadState({ ...content(), conditions: conditionOf({ type: "roll_bonus", name: "BS", rollBonus: "-20", domainMode: "except", domains: { ranged: true } }) });
        attachComputeds(testState());
        rendered = show(<><MeleeAttacks /><RangedAttacks /></>);

        expect(total("r1")).toBe("60");
        expect(value("characteristics.BS.valueForRolls")).toBe(20);
        act(() => updateSignalAtPath(testState(), "meleeAttacks.list.items.m1.roll.baseSelect", "BS"));
        expect(total("m1")).toBe("30");
    });
});
