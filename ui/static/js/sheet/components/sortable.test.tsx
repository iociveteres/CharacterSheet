import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import Sortable from "sortablejs";
import { resolvePath, setLayouts } from "../state/sync";
import { joinPath, usePath } from "./context";
import { DragHandle } from "./ItemControls";
import { TextField } from "./fields";
import { ItemGrid } from "./ItemGrid";
import { Scope } from "./Scope";
import { positionsAfterDrop } from "./useSortable";
import { applyRemote, loadState, recordingActions, renderBlock, testSheet, testState, type Rendered } from "./testUtils";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;

describe("positionsAfterDrop", () => {
    it("numbers the dropped order", () => {
        expect(positionsAfterDrop([["b", "a"], ["c"]], {}, ["a", "b", "c"]))
            .toEqual({ b: pos(0, 0), a: pos(0, 1), c: pos(1, 0) });
    });

    it("drops items deleted during the drag and keeps the place of items created during it", () => {
        expect(positionsAfterDrop([["a", "gone"], ["b"]], { new: pos(1, 0), a: pos(0, 0) }, ["a", "b", "new"]))
            .toEqual({ a: pos(0, 0), new: pos(1, 0), b: pos(1, 1) });
    });

    it("clamps the place of a new item to the grid", () => {
        expect(positionsAfterDrop([["a"]], { x: pos(4, 9) }, ["a", "x"])).toEqual({ a: pos(0, 0), x: pos(0, 1) });
    });
});

function Item({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    return (
        <Scope dataId={itemId} class="condition-item">
            <TextField field="name" />
            <DragHandle />
            <span class="path">{path}</span>
        </Scope>
    );
}

const GRID = "conditions.list.items";

describe("dragging in an ItemGrid", () => {
    let rendered: Rendered;
    let actions: ReturnType<typeof recordingActions>;

    beforeEach(() => {
        loadState({
            conditions: {
                list: {
                    items: { a: { name: "A" }, b: { name: "B" }, c: { name: "C" } },
                    layouts: { a: pos(0, 0), b: pos(0, 1), c: pos(1, 0) },
                },
            },
        });
        actions = recordingActions();
        rendered = renderBlock(
            <ItemGrid dataId={GRID} id="conditions" itemClass="condition-item" renderItem={id => <Item itemId={id} />} />,
            { actions },
        );
    });

    afterEach(() => {
        rendered.unmount();
    });

    const columns = () => Array.from(rendered.container.querySelectorAll<HTMLElement>("#conditions > .layout-column"));
    const ids = () => columns().map(col =>
        Array.from(col.querySelectorAll<HTMLElement>(":scope > .condition-item"), el => el.dataset.id));
    const node = (id: string) => rendered.container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    // Sortable calls these from its pointer handlers; happy-dom cannot drag.
    const sortable = (col: HTMLElement) => Sortable.get(col)!.options as Required<Sortable.Options>;

    it("sets up one Sortable per column, dragging items by their handle", () => {
        const [first] = columns();
        expect(sortable(first).handle).toBe(".drag-handle");
        expect(sortable(first).draggable).toBe(".condition-item");
        expect(sortable(first).forceFallback).toBe(true);
    });

    it("sends the dropped order and lets Preact move the nodes", () => {
        const [col0, col1] = columns();
        const a = node("a");
        act(() => sortable(col0).onStart({ item: a, from: col0 } as unknown as Sortable.SortableEvent));
        expect(testSheet().freeze.isFrozen(GRID)).toBe(true);

        // What Sortable does: a goes below c.
        col1.insertBefore(a, col1.querySelector(".add-slot"));
        act(() => sortable(col0).onEnd({ item: a, from: col0, to: col1 } as unknown as Sortable.SortableEvent));

        expect(testSheet().freeze.isFrozen(GRID)).toBe(false);
        expect(actions.scheduled.at(-1)).toEqual([
            { type: "positionsChanged", path: GRID, positions: { b: pos(0, 0), c: pos(1, 0), a: pos(1, 1) } },
            GRID,
        ]);
        expect(ids()).toEqual([["b"], ["c", "a"]]);
        expect(rendered.container.querySelectorAll('[data-id="a"]')).toHaveLength(1);
    });

    it("holds remote changes until the drop and keeps the grid still meanwhile", () => {
        const [col0, col1] = columns();
        const a = node("a");
        act(() => sortable(col0).onStart({ item: a, from: col0 } as unknown as Sortable.SortableEvent));
        col1.insertBefore(a, col1.querySelector(".add-slot"));

        act(() => {
            // Another player creates an item in the source column and renames b.
            applyRemote({ type: "createItem", path: GRID, itemId: "n", itemPos: pos(0, 0), init: { name: "N" } });
            applyRemote({ type: "change", path: `${GRID}.b.name`, change: "B2" });
        });
        expect(resolvePath(testState(), `${GRID}.n`)).toBeNull();

        // A render with another order would move Sortable's node back into
        // column 0; the frozen grid renders nothing.
        act(() => setLayouts(testState(), GRID, { b: pos(0, 0), a: pos(0, 1), c: pos(1, 0) }));
        expect(ids()).toEqual([["b"], ["c", "a"]]);
        act(() => setLayouts(testState(), GRID, { a: pos(0, 0), b: pos(0, 1), c: pos(1, 0) }));
        expect(resolvePath(testState(), `${GRID}.n`)).toBeNull();
        expect(value(`${GRID}.b.name`)).toBe("B");
        expect(ids()).toEqual([["b"], ["c", "a"]]);

        act(() => sortable(col0).onEnd({ item: a, from: col0, to: col1 } as unknown as Sortable.SortableEvent));

        // The new item keeps its place and is part of the layout sent to the server.
        expect(actions.scheduled.at(-1)![0]).toEqual({
            type: "positionsChanged", path: GRID,
            positions: { n: pos(0, 0), b: pos(0, 1), c: pos(1, 0), a: pos(1, 1) },
        });
        expect(ids()).toEqual([["n", "b"], ["c", "a"]]);
        expect(value(`${GRID}.b.name`)).toBe("B2");
        expect(node("b").querySelector("input")!.value).toBe("B2");
    });

    it("sends nothing when the item is dropped where it was", () => {
        const [col0] = columns();
        const a = node("a");
        act(() => sortable(col0).onStart({ item: a, from: col0 } as unknown as Sortable.SortableEvent));
        act(() => sortable(col0).onEnd({ item: a, from: col0, to: col0 } as unknown as Sortable.SortableEvent));
        expect(actions.scheduled).toHaveLength(0);
        expect(ids()).toEqual([["a", "b"], ["c"]]);
    });

    it("drags nested grids on their own", () => {
        rendered.unmount();
        loadState({
            conditions: {
                list: {
                    items: {
                        c1: { entries: { items: { e1: {}, e2: {} }, layouts: { e1: pos(0, 0), e2: pos(0, 1) } } },
                    },
                },
            },
        });
        // Actions change the state they were made for.
        actions = recordingActions();
        const Entry = ({ itemId }: { itemId: string }) => (
            <Scope dataId={itemId} class="condition-entry"><DragHandle /></Scope>
        );
        const Condition = ({ itemId }: { itemId: string }) => (
            <Scope dataId={itemId} class="condition-item">
                <ItemGrid dataId="entries.items" class="condition-entries" itemClass="condition-entry"
                    renderItem={id => <Entry itemId={id} />} />
            </Scope>
        );
        rendered = renderBlock(
            <ItemGrid dataId={GRID} id="conditions" itemClass="condition-item" renderItem={id => <Condition itemId={id} />} />,
            { actions },
        );

        const entryCol = rendered.container.querySelector<HTMLElement>(".condition-entries > .layout-column")!;
        const e2 = node("e2");
        act(() => sortable(entryCol).onStart({ item: e2, from: entryCol } as unknown as Sortable.SortableEvent));
        expect(testSheet().freeze.isFrozen(`${GRID}.c1.entries.items`)).toBe(true);
        expect(testSheet().freeze.isFrozen(GRID)).toBe(false);

        entryCol.insertBefore(e2, entryCol.firstChild);
        act(() => sortable(entryCol).onEnd({ item: e2, from: entryCol, to: entryCol } as unknown as Sortable.SortableEvent));

        expect(actions.scheduled.at(-1)![0]).toEqual({
            type: "positionsChanged", path: `${GRID}.c1.entries.items`, positions: { e2: pos(0, 0), e1: pos(0, 1) },
        });
        expect(Array.from(entryCol.querySelectorAll<HTMLElement>(".condition-entry"), el => el.dataset.id)).toEqual(["e2", "e1"]);
    });
});
