import { beforeEach, describe, expect, it } from "vitest";
import { loadState, testState } from "../components/testUtils";
import { computed, type Signal } from "@preact/signals-core";
import { applyBatchToState } from "./applyBatch";
import {
    createItemInState, deleteItemFromState, moveItemInState, resolvePath, setLayouts,
} from "./sync";

const layouts = (gridPath: string) => (resolvePath(testState(), gridPath.replace(/items$/, "layouts")) as Signal).value;

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

beforeEach(() => {
    loadState({
        traits: { list: { items: { t1: {}, t2: {} }, layouts: { t1: pos(0, 0), t2: pos(1, 0) } } },
        conditions: {
            list: {
                items: { c1: { entries: { items: { e1: {} }, layouts: { e1: pos(0, 0) } } } },
                layouts: { c1: pos(0, 0) },
            },
        },
        gear: { list: { items: { g1: {} }, layouts: { g1: pos(0, 0) } } },
        psykana: {
            tabs: {
                items: { a: { powers: { items: { p1: {} }, layouts: { p1: pos(0, 0) } } }, b: {} },
                layouts: { a: pos(0, 0), b: pos(0, 1) },
            },
        },
    });
    document.body.innerHTML = "";
});

describe("layouts in the state", () => {
    it("gains the position of a created item", () => {
        createItemInState(testState(), "traits.list.items", "t3", {}, pos(2, 0));
        expect(layouts("traits.list.items")).toEqual({ t1: pos(0, 0), t2: pos(1, 0), t3: pos(2, 0) });
    });

    it("loses the position of a deleted item", () => {
        deleteItemFromState(testState(), "traits.list.items.t1");
        expect(layouts("traits.list.items")).toEqual({ t2: pos(1, 0) });
        deleteItemFromState(testState(), "conditions.list.items.c1.entries.items.e1");
        expect(layouts("conditions.list.items.c1.entries.items")).toEqual({});
    });

    it("moves the position with an item between grids", () => {
        moveItemInState(testState(), "psykana.tabs.items.a.powers.items", "psykana.tabs.items.b.powers.items", "p1", pos(1, 0));
        expect(layouts("psykana.tabs.items.a.powers.items")).toEqual({});
        expect(layouts("psykana.tabs.items.b.powers.items")).toEqual({ p1: pos(1, 0) });
        expect(resolvePath(testState(), "psykana.tabs.items.b.powers.items.p1")).not.toBeNull();
    });

    it("notifies the readers of both grids of a move", () => {
        const keys = (path: string) => computed(() => Object.keys(resolvePath(testState(), path) as object));
        const from = keys("psykana.tabs.items.a.powers.items");
        const to = keys("psykana.tabs.items.b.powers.items");
        expect([from.value, to.value]).toEqual([["p1"], []]);
        moveItemInState(testState(), "psykana.tabs.items.a.powers.items", "psykana.tabs.items.b.powers.items", "p1", pos(0, 0));
        expect([from.value, to.value]).toEqual([[], ["p1"]]);
    });

    it("is replaced by positionsChanged", () => {
        setLayouts(testState(), "traits.list.items", { t1: pos(2, 0), t2: pos(2, 1) });
        expect(layouts("traits.list.items")).toEqual({ t1: pos(2, 0), t2: pos(2, 1) });
    });

    it("is replaced by a batch that carries a grid", () => {
        applyBatchToState(testState(), "conditions.list.items.c1", {
            name: "Fury",
            entries: { items: { e1: { bonus: "1" } }, layouts: { e1: pos(0, 3) } },
        });
        expect(layouts("conditions.list.items.c1.entries.items")).toEqual({ e1: pos(0, 3) });
        expect((resolvePath(testState(), "conditions.list.items.c1.entries.items.e1.bonus") as Signal).value).toBe("1");
    });
});
