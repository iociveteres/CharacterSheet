import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import {
    loadState, recordingActions, recordingAutocomplete, renderBlock, rollOf, teardownSheet, testState, type Rendered,
} from "../components/testUtils";
import type { AutocompleteResult } from "../components/context";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { COMBAT_TAB, NAVIGATION_TABS } from "../state/ui";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { MeleeAttacks, RangedAttacks } from "./Attacks";
import { Gear } from "./Gear";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;
const grid = (...rows: object[]) => ({
    items: Object.fromEntries(rows.map((r, i) => [`e${i}`, r])),
    layouts: Object.fromEntries(rows.map((_, i) => [`e${i}`, pos(0, i)])),
});
const MELEE = "meleeAttacks.list.items";
const RANGED = "rangedAttacks.list.items";
const M1 = `${MELEE}.m1`;

const flaming = { name: "Flaming", capacity: 3, special: "Flame (d10)", level: "l1", entries: grid(), levels: grid({ capacity: 1 }, { capacity: 3 }) };

/** A mithral Longsword of Flaming 3, an own-named blade, a Spear and a rope in the gear; one unnamed melee attack, `m1`. */
function load(m1: object = {}) {
    loadState({
        gear: {
            list: {
                items: {
                    g1: { name: "Longsword", gearType: "weapon", material: { name: "Mithral", pen: 1, entries: grid() }, enchantments: grid(flaming) },
                    g2: { name: "Father's Blade", gearType: "weapon" },
                    g3: { name: "Spear", gearType: "weapon" },
                    g4: { name: "Rope", gearType: "gear" },
                },
                layouts: { g1: pos(0, 0), g2: pos(0, 1), g3: pos(0, 2), g4: pos(0, 3) },
            },
        },
        meleeAttacks: {
            list: {
                items: {
                    m1: {
                        name: "", tabs: { items: { t1: { profile: "sword", damage: "1d10", pen: "0", special: "Primitive" } }, layouts: { t1: pos(0, 0) } },
                        ...m1,
                    },
                },
                layouts: { m1: pos(0, 0) },
            },
        },
    }, pathfinderCrusade);
    attachComputeds(testState());
}

let rendered: Rendered | null = null;
let actions: ReturnType<typeof recordingActions>;
let autocomplete: ReturnType<typeof recordingAutocomplete>;

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    vi.useRealTimers();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const $$ = (selector: string) => Array.from(rendered!.container.querySelectorAll<HTMLElement>(selector));

function show(block: preact.VNode) {
    actions = recordingActions();
    autocomplete = recordingAutocomplete();
    rendered = renderBlock(block, { actions, autocomplete });
}

function type(input: HTMLInputElement, text: string) {
    input.value = text;
    act(() => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(250);
    });
}

/** The server's answer to the query sent last, or to `query`. */
function answer(results: AutocompleteResult[], query = autocomplete.queries.at(-1)!) {
    act(() => {
        document.dispatchEvent(new CustomEvent("ws:autocompleteResult", { detail: { type: "autocompleteResult", eventID: query.eventID, results } }));
    });
}

/** Lets the awaited lookups go on. */
const settle = () => act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
});

const mousedown = (el: Element) => act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
});

const sent = (type: string) => actions.sent.filter(m => (m as { type: string }).type === type) as Record<string, unknown>[];

describe("the In Gear group of an attack's name", () => {
    const name = () => $<HTMLInputElement>(`[data-id="m1"] [data-id="name"]`);
    const options = () => $$(`[data-id="m1"] .autocomplete-option`).map(o => o.textContent);
    const groups = () => $$(`[data-id="m1"] .autocomplete-group`).map(g => g.textContent);

    it("offers the gear's weapons above the rulebook and links the pick, filled from the rulebook entry of its name", async () => {
        load();
        show(<MeleeAttacks />);
        type(name(), "long");
        answer([{ name: "Longsword", name_ru: "Длинный меч", entryType: "Рукопашное оружие" }]);
        expect(groups()).toEqual(["In Gear", "Rulebook"]);
        expect(options()).toEqual(["LongswordMithral · Flaming 3", "Longsword / Длинный мечРукопашное оружие"]);

        mousedown($$(`[data-id="m1"] .autocomplete-option`)[0]);
        expect(autocomplete.queries.at(-1)).toMatchObject({ type: "autocomplete", kind: "pathfinder_crusade", collection: "melee", query: "Longsword" });
        answer([{ name: "Longsword, Bastard" }, { name: "Longsword" }]);
        await settle();
        expect(sent("autocompleteApply").at(-1)).toMatchObject({ path: M1, collection: "melee", name: "Longsword", base: { item: "g1" } });
    });

    it("only names and links the attack to an item the rulebook lacks", async () => {
        load();
        show(<MeleeAttacks />);
        type(name(), "blade");
        answer([]);
        expect(groups()).toEqual(["In Gear"]);
        mousedown($$(`[data-id="m1"] .autocomplete-option`)[0]);
        answer([{ name: "Blade of Ages" }]);
        await settle();
        expect(sent("autocompleteApply")).toEqual([]);
        expect(value(`${M1}.name`)).toBe("Father's Blade");
        expect(value(`${M1}.item`)).toBe("g2");
    });

    it("leaves out an item another attack of the block is linked to", () => {
        load();
        updateSignalAtPath(testState(), `${MELEE}.m1.item`, "");
        actions = recordingActions();
        actions.createItem(MELEE, "m2", { name: "Longsword", item: "g1" }, pos(0, 1));
        show(<MeleeAttacks />);
        type(name(), "long");
        answer([{ name: "Longsword" }]);
        expect(groups()).toEqual([]);
        expect(options()).toEqual(["Longsword"]);
    });
});

describe("the Item row of an attack", () => {
    const select = () => $<HTMLSelectElement>(`[data-id="m1"] [data-id="item"]`);

    it("lists the gear's weapons with their material, links and unlinks, and names the linked item's enchantments", () => {
        load();
        show(<MeleeAttacks />);
        expect(Array.from(select().options, o => o.text)).toEqual(["—", "Longsword · Mithral", "Father's Blade", "Spear"]);
        expect($(`[data-id="itemNote"]`)).toBeNull();

        act(() => {
            select().value = "g1";
            select().dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(value(`${M1}.item`)).toBe("g1");
        expect($(`[data-id="m1"] [data-id="itemNote"]`).textContent).toBe("Flaming 3");

        act(() => {
            select().value = "";
            select().dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(value(`${M1}.item`)).toBe("");
    });

    it("shows a deleted item dimmed, and the attack gets nothing of it", () => {
        load({ item: "gone" });
        show(<MeleeAttacks />);
        expect(select().selectedOptions[0].text).toBe("deleted");
        expect(select().classList.contains("dimmed")).toBe(true);
        expect($(`[data-id="m1"] [data-id="itemProperties"]`)).toBeNull();
    });

    it("adds the enchantments' Special after the profile's, as a grip's property", () => {
        load({ item: "g1" });
        show(<MeleeAttacks />);
        const added = $<HTMLElement>(`[data-id="t1"] [data-id="itemProperties"]`);
        expect(added.textContent).toBe("+ Flame (d10)");
        expect(added.title).toBe("Flame (d10): the Flaming 3 enchantment of Longsword");
    });

    it("shows the material's Pen in the window and marks the damage roll of a broken item", () => {
        load({ name: "Longsword", item: "g1" });
        updateSignalAtPath(testState(), "gear.list.items.g1.broken", true);
        show(<MeleeAttacks />);
        act(() => $<HTMLButtonElement>(`[data-id="t1"] .pen .mod-toggle`).click());
        expect($$(`[data-id="t1"] .pen [data-id="added"] span`).map(s => s.textContent)).toEqual(["+1", "Mithral (Longsword)"]);

        act(() => $<HTMLButtonElement>(`[data-id="t1"] .damage .mod-toggle`).click());
        expect($(`[data-id="t1"] .damage [data-id="note"]`).textContent).toBe("½ after armour: Longsword is broken");

        const rolls: unknown[] = [];
        const listener = (e: Event) => rolls.push(rollOf((e as CustomEvent).detail));
        document.addEventListener("sheet:rollExact", listener);
        $<HTMLElement>(`[data-id="t1"] .damage label`).click();
        document.removeEventListener("sheet:rollExact", listener);
        expect(rolls).toEqual([{ expression: "1d10", label: "Longsword, sword (broken: ½ after armour)" }]);
    });

    it("is not shown to a viewer of an attack without a link", () => {
        load();
        rendered = renderBlock(<MeleeAttacks />, { canEdit: false });
        expect($(`[data-id="m1"] .item-link-row`)).toBeNull();
    });
});

describe("the Attacks row of a gear weapon", () => {
    const item = (id: string) => $<HTMLElement>(`[data-id="${id}"]`);
    const add = (id: string) => act(() => item(id).querySelector<HTMLButtonElement>(`[data-id="addAttack"]`)!.click());
    /** Answers the lookups of the melee and ranged collections sent last. */
    function lookups(melee: AutocompleteResult[], ranged: AutocompleteResult[]) {
        const [m, r] = autocomplete.queries.slice(-2);
        expect([m.collection, r.collection]).toEqual(["melee", "ranged"]);
        answer(melee, m);
        answer(ranged, r);
    }

    it("makes one attack from the rulebook when one collection has the item's name", async () => {
        load();
        show(<Gear />);
        add("g1");
        expect(autocomplete.queries.slice(-2)).toMatchObject([{ query: "Longsword" }, { query: "Longsword" }]);
        lookups([{ name: "Longsword" }], [{ name: "Longsword Thrower" }]);
        await settle();
        const [created] = sent("createItem");
        expect(created).toMatchObject({ path: MELEE, init: { name: "Longsword", item: "g1" } });
        expect(sent("autocompleteApply")).toMatchObject([
            { path: `${MELEE}.${created.itemId}`, collection: "melee", name: "Longsword", base: { item: "g1" } },
        ]);
    });

    it("offers the melee and the ranged attack when both have it", async () => {
        load();
        show(<Gear />);
        add("g3");
        lookups([{ name: "Spear" }], [{ name: "spear" }]);
        await settle();
        expect(sent("createItem")).toEqual([]);
        const choice = item("g3").querySelector(`[data-id="attackChoice"]`)!;
        expect(Array.from(choice.querySelectorAll("button"), b => b.textContent)).toEqual(["Melee", "Ranged", "Both", "✖"]);
        act(() => Array.from(choice.querySelectorAll("button")).find(b => b.textContent === "Both")!.click());
        expect(sent("createItem").map(m => m.path)).toEqual([MELEE, RANGED]);
        expect(sent("autocompleteApply").map(m => [m.collection, m.name])).toEqual([["melee", "Spear"], ["ranged", "spear"]]);
        expect(item("g3").querySelector(`[data-id="attackChoice"]`)).toBeNull();
    });

    it("makes an empty melee attack of the item's name when the rulebook has none", async () => {
        load();
        show(<Gear />);
        add("g2");
        lookups([], []);
        await settle();
        const [created] = sent("createItem") as { init: { name: string; item: string; tabs: { items: object } } }[];
        expect(created).toMatchObject({ path: MELEE, init: { name: "Father's Blade", item: "g2" } });
        expect(Object.keys(created.init.tabs.items)).toHaveLength(1);
        expect(sent("autocompleteApply")).toEqual([]);
    });

    it("shows the linked attacks as chips that open the Combat tab; none on other gear", () => {
        load({ name: "Longsword", item: "g1" });
        show(<Gear />);
        const chip = item("g1").querySelector<HTMLButtonElement>(".attack-chip button")!;
        expect(chip.textContent).toBe("⚔ Longsword");
        expect(item("g2").querySelector(".attack-chip")).toBeNull();
        expect(item("g4").querySelector(`[data-id="attacks"]`)).toBeNull();
        act(() => chip.click());
        expect(rendered!.env.ui.selectedTabSignal(NAVIGATION_TABS).value).toBe(COMBAT_TAB);
    });

    it("knows This item in the weapon entries inside a gear item", () => {
        load();
        updateSignalAtPath(testState(), "gear.list.items.g1.description", "x");
        actions = recordingActions();
        actions.createItem("gear.list.items.g1.entries.items", "c1", { type: "weapon_bonus", name: "This item", weaponField: "balance", weaponBonus: "1" }, pos(0, 0));
        show(<Gear />);
        const entryName = item("g1").querySelector<HTMLInputElement>(`[data-id="c1"] [data-id="name"]`)!;
        expect(entryName.value).toBe("This item");
        expect(entryName.classList.contains("invalid")).toBe(false);
    });
});

describe("a ranged attack", () => {
    it("links to a gear weapon through its Item row as a melee attack does", () => {
        load();
        actions = recordingActions();
        actions.createItem(RANGED, "r1", { name: "Spear", class: "throwing", item: "g3" }, pos(0, 0));
        show(<RangedAttacks />);
        expect($<HTMLSelectElement>(`[data-id="r1"] [data-id="item"]`).selectedOptions[0].text).toBe("Spear");
    });
});
