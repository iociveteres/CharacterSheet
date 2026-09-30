import { beforeEach, describe, expect, it } from "vitest";
import { loadState, testSheet, testState } from "../components/testUtils";
import { computed, signal, type Signal } from "@preact/signals-core";
import { resolvePath } from "./sync";
import { applyRemoteToState, type RemoteSheetMessage } from "./remote";
import { createSheetActions } from "./actions";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal).value;
const ids = (gridPath: string) => Object.keys(resolvePath(testState(), gridPath) as object);

beforeEach(() => {
    loadState({
        conditions: {
            list: {
                items: {
                    c1: {
                        name: "Old", enabled: false, stacks: 5,
                        entries: { items: { e1: { type: "char_cap", name: "WS", cap: "10" } }, layouts: { e1: pos(0, 0) } },
                    },
                },
                layouts: { c1: pos(0, 0) },
            },
        },
        talents: { list: { items: { t1: { name: "Talent" } }, layouts: { t1: pos(0, 0) } } },
    });
});

const apply = (msg: RemoteSheetMessage) => applyRemoteToState(testSheet(), msg);

describe("remote changes", () => {
    it("write a change to the signal", () => {
        apply({ type: "change", path: "conditions.list.items.c1.name", change: "Fury" });
        expect(value("conditions.list.items.c1.name")).toBe("Fury");
    });

    it("build a created item from init with the schema defaults", () => {
        const talents = computed(() => Object.keys(resolvePath(testState(), "talents.list.items") as object));
        expect(talents.value).toEqual(["t1"]);
        apply({ type: "createItem", path: "talents.list.items", itemId: "t2", itemPos: pos(2, 0), init: { name: "New" } });

        expect(value("talents.list.items.t2.name")).toBe("New");
        expect(value("talents.list.items.t2.description")).toBe("");
        expect(value("talents.list.layouts")).toEqual({ t1: pos(0, 0), t2: pos(2, 0) });
        expect(talents.value).toEqual(["t1", "t2"]);
    });

    it("build nested grids of a created item and notify readers of the entries of all conditions", () => {
        apply({
            type: "createItem", path: "conditions.list.items", itemId: "c2", itemPos: pos(1, 0),
            init: { enabled: true, stacks: 1, entries: { items: { e2: { type: "char_bonus" } }, layouts: { e2: pos(0, 0) } } },
        });
        expect(value("conditions.list.items.c2.entries.items.e2.type")).toBe("char_bonus");
        expect(value("conditions.list.items.c2.entries.items.e2.bonus")).toBe("");
        expect(value("conditions.list.items.c2.entries.layouts")).toEqual({ e2: pos(0, 0) });

        const entries = computed(() => Object.values(resolvePath(testState(), "conditions.list.items") as Record<string, { entries: { items: object } }>).flatMap(c => Object.keys(c.entries.items)));
        expect(entries.value).toEqual(["e1", "e2"]);
        apply({ type: "createItem", path: "conditions.list.items.c2.entries.items", itemId: "e3", itemPos: pos(0, 1), init: {} });
        expect(value("conditions.list.items.c2.entries.items.e3.type")).toBe("char_bonus");
        expect(entries.value).toEqual(["e1", "e2", "e3"]);
    });

    it("delete items, replace positions and move items", () => {
        apply({ type: "positionsChanged", path: "conditions.list.items", positions: { c1: pos(1, 0) } });
        expect(value("conditions.list.layouts")).toEqual({ c1: pos(1, 0) });

        apply({ type: "deleteItem", path: "conditions.list.items.c1.entries.items.e1" });
        expect(ids("conditions.list.items.c1.entries.items")).toEqual([]);

        apply({ type: "deleteItem", path: "talents.list.items.t1" });
        expect(ids("talents.list.items")).toEqual([]);
        expect(value("talents.list.layouts")).toEqual({});
    });

    it("replace a grid carried by a batch and normalize its values", () => {
        const collapsed = signal(true);
        testSheet().ui.registerCollapsible("conditions.list.items.c1", { collapsed, hasContent: () => true, autoExpand: true, el: null });

        apply({
            type: "batch", path: "conditions.list.items.c1",
            changes: {
                stacks: "3",
                unknown: "dropped",
                entries: { items: { e9: { type: "skill_bonus", name: "Dodge" } } },
            },
        });

        expect(value("conditions.list.items.c1.stacks")).toBe(3);
        expect(resolvePath(testState(), "conditions.list.items.c1.unknown")).toBeNull();
        expect(ids("conditions.list.items.c1.entries.items")).toEqual(["e9"]);
        expect(value("conditions.list.items.c1.entries.items.e9.skillBonus")).toBe("");
        // The server replaces entries as a whole, layouts included.
        expect(value("conditions.list.items.c1.entries.layouts")).toEqual({});
        expect(collapsed.value).toBe(false);
    });

    it("replace the item on an autocomplete batch, as the server does", () => {
        // What the server sends: the entry laid over the base the picker sent.
        const changes = { enabled: true, stacks: 1, name: "Fury" };
        apply({ type: "autocompleteApplied", path: "conditions.list.items.c1", changes });

        expect(value("conditions.list.items.c1.name")).toBe("Fury");
        expect(value("conditions.list.items.c1.enabled")).toBe(true);
        expect(value("conditions.list.items.c1.stacks")).toBe(1);
        expect(ids("conditions.list.items.c1.entries.items")).toEqual([]);
    });

    it("keep an item collapsed when it does not expand on batches", () => {
        const collapsed = signal(true);
        testSheet().ui.registerCollapsible("talents.list.items.t1", { collapsed, hasContent: () => true, autoExpand: false, el: null });
        apply({ type: "batch", path: "talents.list.items.t1", changes: { name: "X" } });
        expect(collapsed.value).toBe(true);
    });
});

describe("remote changes while a grid is dragged", () => {
    it("wait for the drop and run in order", () => {
        testSheet().freeze.freeze("conditions.list.items");
        apply({ type: "createItem", path: "conditions.list.items", itemId: "c2", itemPos: pos(1, 0), init: {} });
        apply({ type: "change", path: "conditions.list.items.c2.name", change: "Late" });
        apply({ type: "change", path: "talents.list.items.t1.name", change: "Now" });

        expect(resolvePath(testState(), "conditions.list.items.c2")).toBeNull();
        expect(value("talents.list.items.t1.name")).toBe("Now");

        for (const op of testSheet().freeze.thaw("conditions.list.items")) op();
        expect(value("conditions.list.items.c2.name")).toBe("Late");
    });

    it("also wait when they touch a grid nested in the dragged one or its parent", () => {
        testSheet().freeze.freeze("conditions.list.items.c1.entries.items");
        apply({ type: "positionsChanged", path: "conditions.list.items", positions: { c1: pos(1, 0) } });
        expect(value("conditions.list.layouts")).toEqual({ c1: pos(0, 0) });
        expect(testSheet().freeze.thaw("conditions.list.items.c1.entries.items")).toHaveLength(1);
    });
});

describe("sheet actions", () => {
    it("change the state and send their messages", () => {
        const sent: object[] = [];
        const scheduled: [object, string][] = [];
        const actions = createSheetActions(testState(), {
            send: msg => sent.push(msg),
            schedule: (msg, key) => scheduled.push([msg, key]),
        });

        actions.createItem("talents.list.items", "t2", { name: "", description: "" }, pos(1, 0));
        expect(value("talents.list.items.t2.name")).toBe("");
        expect(sent.at(-1)).toEqual({
            type: "createItem", path: "talents.list.items", itemId: "t2", itemPos: pos(1, 0),
            init: { name: "", description: "" },
        });

        actions.positionsChanged("talents.list.items", { t1: pos(0, 1), t2: pos(0, 0) });
        expect(value("talents.list.layouts")).toEqual({ t1: pos(0, 1), t2: pos(0, 0) });
        expect(scheduled.at(-1)).toEqual([
            { type: "positionsChanged", path: "talents.list.items", positions: { t1: pos(0, 1), t2: pos(0, 0) } },
            "talents.list.items",
        ]);

        actions.deleteItem("talents.list.items.t2");
        expect(resolvePath(testState(), "talents.list.items.t2")).toBeNull();
        expect(sent.at(-1)).toEqual({ type: "deleteItem", path: "talents.list.items.t2" });

        actions.autocompleteApply("talents.list.items.t1", "talents", "Ambidextrous");
        expect(sent.at(-1)).toEqual({
            type: "autocompleteApply", path: "talents.list.items.t1", collection: "talents", name: "Ambidextrous",
            base: {},
        });
    });
});
