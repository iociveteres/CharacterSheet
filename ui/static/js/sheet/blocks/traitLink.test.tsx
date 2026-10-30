import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import {
    loadState, recordingActions, recordingAutocomplete, renderBlock, teardownSheet, testState, type Rendered,
} from "../components/testUtils";
import type { AutocompleteResult } from "../components/context";
import type { SheetKindDef } from "../kinds/kind";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { deleteItemFromState, resolvePath, updateSignalAtPath } from "../state/sync";
import { MeleeAttacks } from "./Attacks";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;
const MELEE = "meleeAttacks.list.items";
const M1 = `${MELEE}.m1`;

/** The traits `traits` (t0, t1…), a Longsword in the gear and one unnamed melee attack, `m1`. */
function load(traits: string[], m1: object = {}, kind: SheetKindDef = pathfinderCrusade) {
    loadState({
        traits: {
            list: {
                items: Object.fromEntries(traits.map((name, i) => [`t${i}`, { name }])),
                layouts: Object.fromEntries(traits.map((_, i) => [`t${i}`, pos(0, i)])),
            },
        },
        gear: { list: { items: { g1: { name: "Longsword", gearType: "weapon" } }, layouts: { g1: pos(0, 0) } } },
        meleeAttacks: {
            list: {
                items: {
                    m1: {
                        name: "", tabs: { items: { t1: { profile: "claws", damage: "1d10", pen: "0", special: "Primitive" } }, layouts: { t1: pos(0, 0) } },
                        ...m1,
                    },
                },
                layouts: { m1: pos(0, 0) },
            },
        },
    }, kind);
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

function show() {
    actions = recordingActions();
    autocomplete = recordingAutocomplete();
    rendered = renderBlock(<MeleeAttacks />, { actions, autocomplete });
}

function type(input: HTMLInputElement, text: string) {
    input.value = text;
    act(() => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(250);
    });
}

/** The server's answer to the query sent last. */
function answer(results: AutocompleteResult[]) {
    const query = autocomplete.queries.at(-1)!;
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
const name = () => $<HTMLInputElement>(`[data-id="m1"] [data-id="name"]`);
const options = () => $$(`[data-id="m1"] .autocomplete-option`).map(o => o.textContent);
const groups = () => $$(`[data-id="m1"] .autocomplete-group`).map(g => g.textContent);
const select = () => $<HTMLSelectElement>(`[data-id="m1"] [data-id="trait"]`);
const choose = (id: string) => act(() => {
    select().value = id;
    select().dispatchEvent(new Event("change", { bubbles: true }));
});

const CLAWS = { name: "Claws (Natural Weapons)", name_ru: "Когти (Естественное Оружие)", entryType: "Трейт", trait: "Natural Weapons (X)" };
const DEADLY_CLAWS = { name: "Claws (Deadly Natural Weapons)", entryType: "Трейт", trait: "Deadly Natural Weapons (X)" };

describe("the In Traits group of a melee attack's name", () => {
    it("offers the weapons of each Natural Weapons trait of the sheet above the rulebook", () => {
        load(["Natural Weapons (2)", "Toxic (1)", "Deadly Natural Weapons (3)"]);
        show();
        type(name(), "cla");
        answer([CLAWS]);
        expect(groups()).toEqual(["In Traits", "Rulebook"]);
        expect(options()).toEqual([
            "Claws (Natural Weapons) / КогтиNatural Weapons (2)",
            "Claws (Deadly Natural Weapons) / КогтиDeadly Natural Weapons (3)",
            "Claws (Natural Weapons) / Когти (Естественное Оружие)Трейт",
        ]);

        type(name(), "natural");
        answer([]);
        expect(options()).toHaveLength(14);
    });

    it("offers only the weapon the trait's Y names", () => {
        load(["Natural Weapons (2, Claws)"]);
        show();
        type(name(), "natural");
        answer([]);
        expect(options()).toEqual(["Claws (Natural Weapons) / КогтиNatural Weapons (2, Claws)"]);
    });

    it("fills the attack from the rulebook's profile and links it to the trait, without X in the modifiers", async () => {
        load(["Natural Weapons (2)", "Deadly Natural Weapons (3)"]);
        show();
        type(name(), "claws");
        answer([]);
        mousedown($$(`[data-id="m1"] .autocomplete-option`)[1]);
        expect(autocomplete.queries.at(-1)).toMatchObject({ collection: "melee", query: "Claws (Deadly Natural Weapons)" });
        answer([CLAWS, DEADLY_CLAWS]);
        await settle();
        const [applied] = sent("autocompleteApply");
        expect(applied).toMatchObject({ path: M1, collection: "melee", name: "Claws (Deadly Natural Weapons)", base: { trait: "t1" } });
        expect(applied).not.toHaveProperty("rating");
    });

    it("is not there in Black Crusade, nor is the Trait row", () => {
        load(["Natural Weapons (X)"], {}, blackCrusade);
        show();
        type(name(), "nat");
        answer([{ name: "Natural Blade" }]);
        expect(groups()).toEqual([]);
        expect(options()).toEqual(["Natural Blade"]);
        expect(select()).toBeNull();
    });
});

describe("a rulebook pick of a Natural Weapons profile", () => {
    function pick(result: AutocompleteResult) {
        type(name(), "claws");
        answer([result]);
        mousedown($$(`[data-id="m1"] .autocomplete-option`).at(-1)!);
        return sent("autocompleteApply").at(-1)!;
    }

    it("puts in X of the sheet's trait of its name", () => {
        load(["Deadly Natural Weapons (3)", "Natural Weapons (2)"]);
        show();
        expect(pick(CLAWS)).toMatchObject({ name: "Claws (Natural Weapons)", rating: "2" });
        expect(pick(DEADLY_CLAWS)).toMatchObject({ name: "Claws (Deadly Natural Weapons)", rating: "3" });
    });

    it("puts in X itself, a modifier to fill, without such a trait", () => {
        load(["Natural Weapons (X)"]);
        show();
        expect(pick(DEADLY_CLAWS)).toMatchObject({ rating: "X" });
        expect(pick(CLAWS)).toMatchObject({ rating: "X" });
    });

    it("leaves a weapon as it was", () => {
        load(["Natural Weapons (2)"]);
        show();
        const applied = pick({ name: "Claw Blade", entryType: "Рукопашное оружие" });
        expect(applied).toMatchObject({ name: "Claw Blade" });
        expect(applied).not.toHaveProperty("rating");
    });
});

describe("the Trait row of a melee attack", () => {
    it("lists the sheet's Natural Weapons traits, links and unlinks", () => {
        load(["Natural Weapons (2)", "Toxic (1)", "Deadly Natural Weapons (3)"]);
        show();
        expect(Array.from(select().options, o => o.text)).toEqual(["—", "Natural Weapons (2)", "Deadly Natural Weapons (3)"]);
        choose("t2");
        expect(value(`${M1}.trait`)).toBe("t2");
        // The Item row gives way to the trait.
        expect($(`[data-id="m1"] [data-id="item"]`)).toBeNull();
        choose("");
        expect(value(`${M1}.trait`)).toBe("");
        expect($(`[data-id="m1"] [data-id="item"]`)).not.toBeNull();
    });

    it("gives way to a linked gear item", () => {
        load(["Natural Weapons (2)"], { item: "g1" });
        show();
        expect(select()).toBeNull();
    });

    it("shows X in the damage window, named by the trait", () => {
        load(["Natural Weapons (2)"], { trait: "t0" });
        show();
        act(() => $<HTMLButtonElement>(`[data-id="t1"] .damage .mod-toggle`).click());
        expect($$(`[data-id="t1"] .damage [data-id="added"] span`).map(s => s.textContent)).toEqual(["+2", "Natural Weapons (2)"]);
    });

    it("warns when the trait's name has no number", () => {
        load(["Natural Weapons (X)"], { trait: "t0" });
        show();
        expect(select().classList.contains("invalid")).toBe(true);
        expect(select().title).toContain("X counts as 0");
    });

    it("shows a deleted trait dimmed", () => {
        load(["Natural Weapons (2)"], { trait: "t0" });
        deleteItemFromState(testState(), "traits.list.items.t0");
        show();
        expect(select().selectedOptions[0].text).toBe("deleted");
        expect(select().classList.contains("dimmed")).toBe(true);
    });

    it("keeps the option of a trait renamed into another, dimmed", () => {
        load(["Natural Weapons (2)"], { trait: "t0" });
        updateSignalAtPath(testState(), "traits.list.items.t0.name", "Natural Armour (2)");
        show();
        expect(select().selectedOptions[0].text).toBe("Natural Armour (2)");
        expect(select().classList.contains("dimmed")).toBe(true);
    });

    it("is not shown to a viewer of an attack without a link", () => {
        load(["Natural Weapons (2)"]);
        rendered = renderBlock(<MeleeAttacks />, { canEdit: false });
        expect(select()).toBeNull();
    });
});
