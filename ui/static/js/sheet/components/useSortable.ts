// Dragging items of a Preact grid with Sortable. Sortable moves DOM nodes
// that Preact owns, so the grid is frozen for the drag: it does not
// re-render, and remote changes that touch it wait (state/dragFreeze.ts). On
// drop the node goes back where it was, the waiting changes apply, and the new
// order goes into the layouts signal; Preact then moves the nodes itself.
import type { RefObject } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { batch, type Signal } from "@preact/signals-core";
import Sortable from "sortablejs";
import { freezeGrid, isFrozen, thawGrid } from "../state/dragFreeze";
import type { SheetActions } from "../state/actions";
import type { Position } from "../schema/content.gen";
import { resolvePath } from "../state/sync.js";

type Positions = { [id: string]: Position };

/**
 * The positions after a drop. `dropped` is the order the player left in the
 * DOM; `layouts` and `ids` are the state after the changes that waited for
 * the drop. Items deleted meanwhile drop out, items created meanwhile keep
 * the place their creator gave them. All rows are renumbered, so the result
 * is the complete layout, as positionsChanged of old grids sends it.
 */
export function positionsAfterDrop(dropped: string[][], layouts: Positions, ids: readonly string[]): Positions {
    const present = new Set(ids);
    const cols = dropped.map(col => col.filter(id => present.has(id)));
    const placed = new Set(cols.flat());

    const added = ids
        .filter(id => !placed.has(id))
        .map(id => ({ id, pos: layouts[id] }))
        .sort((a, b) => (a.pos?.colIndex ?? 0) - (b.pos?.colIndex ?? 0) || (a.pos?.rowIndex ?? 0) - (b.pos?.rowIndex ?? 0));
    for (const { id, pos } of added) {
        const c = Math.min(Math.max(pos?.colIndex ?? 0, 0), cols.length - 1);
        const r = Math.min(Math.max(pos?.rowIndex ?? cols[c].length, 0), cols[c].length);
        cols[c].splice(r, 0, id);
    }

    const out: Positions = {};
    cols.forEach((col, colIndex) => col.forEach((id, rowIndex) => { out[id] = { colIndex, rowIndex }; }));
    return out;
}

function samePositions(a: Positions, b: Positions): boolean {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(id => b[id] && a[id].colIndex === b[id].colIndex && a[id].rowIndex === b[id].rowIndex);
}

function ownColumns(grid: Element): HTMLElement[] {
    return Array.from(grid.children).filter((el): el is HTMLElement => el.classList.contains("layout-column"));
}

function snapshot(grid: Element, itemClass: string): string[][] {
    return ownColumns(grid).map(col => Array.from(col.children)
        .filter(el => el.classList.contains(itemClass) && !el.classList.contains("sortable-fallback"))
        .map(el => (el as HTMLElement).dataset.id!));
}

export interface SortableOptions {
    gridPath: string;
    /** Class of an item's root element; only those are dragged. */
    itemClass: string;
    /** Column count; Sortable is set up again when it changes. */
    columns: number;
    enabled: boolean;
    actions: SheetActions;
}

/**
 * Makes the columns of the grid element sortable. Returns a signal that is
 * true during a drag; the grid must not re-render its columns while it is.
 * Items move between the columns of one grid; dragging into other grids
 * (powers between tabs) is added with Psykana.
 */
export function useSortable(gridRef: RefObject<HTMLElement>, { gridPath, itemClass, columns, enabled, actions }: SortableOptions): Signal<boolean> {
    const dragging = useSignal(false);

    useLayoutEffect(() => {
        const grid = gridRef.current;
        if (!grid || !enabled) return;

        let origin: { item: HTMLElement; parent: Node; next: Node | null } | null = null;

        const onStart = (evt: Sortable.SortableEvent) => {
            origin = { item: evt.item, parent: evt.item.parentNode!, next: evt.item.nextSibling };
            evt.item.classList.add("is-dragging");
            freezeGrid(gridPath);
            dragging.value = true;
        };

        const onEnd = (evt: Sortable.SortableEvent) => {
            evt.item.classList.remove("is-dragging");
            if (!origin) return;
            const dropped = snapshot(grid, itemClass);
            // Preact moves the node itself once the layouts change.
            origin.parent.insertBefore(origin.item, origin.next);
            origin = null;

            batch(() => {
                for (const op of thawGrid(gridPath)) op();
                const layoutsNode = resolvePath(gridPath.replace(/items$/, "layouts")) as Signal<Positions> | null;
                const layouts = layoutsNode?.value ?? {};
                const items = resolvePath(gridPath);
                const ids = items && typeof items === "object" ? Object.keys(items) : [];
                const positions = positionsAfterDrop(dropped, layouts, ids);
                if (!samePositions(positions, layouts)) actions.positionsChanged(gridPath, positions);
                // The grid renders again, with what changed meanwhile.
                dragging.value = false;
            });
        };

        const instances = ownColumns(grid).map(col => Sortable.create(col, {
            group: `grid:${gridPath}`,
            draggable: `.${itemClass}`,
            handle: ".drag-handle",
            animation: 150,
            ghostClass: "sortable-ghost",
            // The fallback clone stays inside the shadow root and gets the sheet's styles.
            forceFallback: true,
            fallbackTolerance: 3,
            onStart,
            onEnd,
        }));

        return () => {
            instances.forEach(s => s.destroy());
            if (isFrozen(gridPath)) {
                for (const op of thawGrid(gridPath)) op();
            }
            dragging.value = false;
        };
    }, [gridPath, itemClass, columns, enabled]);

    return dragging;
}
