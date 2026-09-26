// Dragging items of a Preact grid, or tab labels, with Sortable. Sortable moves DOM nodes
// that Preact owns, so the grid is frozen for the drag: it does not
// re-render, and remote changes that touch it wait (state/dragFreeze.ts). On
// drop the node goes back where it was, the waiting changes apply, and the new
// order goes into the layouts signal; Preact then moves the nodes itself.
import type { RefObject } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { batch, type Signal } from "@preact/signals-core";
import Sortable from "sortablejs";
import { freezeGrid, isFrozen, thawGrid } from "../state/dragFreeze";
import type { SheetActions } from "../state/actions";
import type { Position } from "../schema/content.gen";
import { resolvePath } from "../state/sync";
import { selectedTabSignal } from "../state/ui";

type Positions = { [id: string]: Position };

// The state path of each sortable element: an item dropped into another grid
// of the group, or into the panel of another tab, finds its path here.
const sortablePaths = new WeakMap<Element, string>();

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

function columnItems(col: Element, itemClass: string): HTMLElement[] {
    return Array.from(col.children).filter((el): el is HTMLElement =>
        el.classList.contains(itemClass) && !el.classList.contains("sortable-fallback"));
}

function stateLayouts(gridPath: string): { layouts: Positions; ids: string[] } {
    const layoutsNode = resolvePath(gridPath.replace(/items$/, "layouts")) as Signal<Positions> | null;
    const items = resolvePath(gridPath);
    return {
        layouts: layoutsNode?.value ?? {},
        ids: items && typeof items === "object" ? Object.keys(items) : [],
    };
}

/** The element under a point, looking into shadow roots. */
function elementFromPointDeep(x: number, y: number): Element | null {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
    }
    return el;
}

const TAB_HOVER_DELAY = 500;

/**
 * Opens the tab whose label the dragged item rests on for a moment: checks
 * its radio and fires change, as a click would. Returns the stop function.
 */
function openTabsOnHover(root: Document | ShadowRoot): () => void {
    let hovered: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onMove = (e: PointerEvent | MouseEvent) => {
        const label = elementFromPointDeep(e.clientX, e.clientY)?.closest(".tablabel") ?? null;
        if (label === hovered) return;
        hovered?.classList.remove("drag-over");
        clearTimeout(timer);
        hovered = label;
        if (!label) return;
        label.classList.add("drag-over");
        timer = setTimeout(() => {
            const radio = root.getElementById(label.getAttribute("for") ?? "") as HTMLInputElement | null;
            if (radio && !radio.checked) {
                radio.checked = true;
                radio.dispatchEvent(new Event("change", { bubbles: true }));
            }
        }, TAB_HOVER_DELAY);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mousemove", onMove, { passive: true });
    return () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("mousemove", onMove);
        clearTimeout(timer);
        hovered?.classList.remove("drag-over");
    };
}

export interface SortableOptions {
    gridPath: string;
    /** Class of an item's root element; only those are dragged. */
    itemClass: string;
    /** Column count; Sortable is set up again when it changes. */
    columns: number;
    /** The items are children of the root itself, as tab labels are, not of its .layout-column children. */
    flat?: boolean;
    enabled: boolean;
    actions: SheetActions;
    /**
     * Lets items move between the grids of one group, e.g. powers between
     * the tabs of Psykana. `freezePath` holds all of them (the tabs) and is
     * frozen for the drag; hovering a tab label opens its tab.
     */
    shared?: { group: string; freezePath: string };
}

/**
 * Makes the columns of the grid element sortable. The grid is frozen for the
 * drag, and a component that renders it finds out with isRenderFrozen.
 * Items move between the columns of the grid, and with `shared` between the
 * grids of the group: the drop sends moveItemBetweenGrids and the complete
 * layout of the grid the item landed in, since the server stores only the
 * moved item's position there.
 */
export function useSortable(gridRef: RefObject<HTMLElement>, { gridPath, itemClass, columns, flat = false, enabled, actions, shared }: SortableOptions): void {
    const freezePath = shared?.freezePath ?? gridPath;
    const group = shared?.group ?? `grid:${gridPath}`;

    useLayoutEffect(() => {
        const grid = gridRef.current;
        if (!grid) return;
        sortablePaths.set(grid, gridPath);
        if (!enabled) return () => { sortablePaths.delete(grid); };
        const columnsOf = (el: Element): HTMLElement[] => (flat ? [el as HTMLElement] : ownColumns(el));

        let origin: { item: HTMLElement; parent: Node; next: Node | null } | null = null;
        let stopHover: (() => void) | null = null;

        const onStart = (evt: Sortable.SortableEvent) => {
            origin = { item: evt.item, parent: evt.item.parentNode!, next: evt.item.nextSibling };
            evt.item.classList.add("is-dragging");
            freezeGrid(freezePath);
            if (shared) stopHover = openTabsOnHover(grid.getRootNode() as Document | ShadowRoot);
        };

        const onEnd = (evt: Sortable.SortableEvent) => {
            evt.item.classList.remove("is-dragging");
            stopHover?.();
            stopHover = null;
            if (!origin) return;

            // Only an item of a shared grid can land in another grid: the one holding the column it was dropped in.
            const toGrid = shared ? evt.to.parentElement! : grid;
            const moved = toGrid !== grid;
            const dropped = columnsOf(toGrid).map(col => columnItems(col, itemClass).map(el => el.dataset.id!));
            const itemId = evt.item.dataset.id!;
            const toPath = moved ? sortablePaths.get(toGrid) : gridPath;
            const toPosition = moved
                ? { colIndex: Math.max(0, columnsOf(toGrid).indexOf(evt.to)), rowIndex: Math.max(0, columnItems(evt.to, itemClass).indexOf(evt.item)) }
                : null;
            // The tab the item landed in stays open.
            const panel = moved ? toGrid.closest<HTMLElement>(".panel") : null;
            // Preact moves the node itself once the state changes.
            origin.parent.insertBefore(origin.item, origin.next);
            origin = null;

            const drop = () => {
                if (!toPath) return;
                if (toPosition) {
                    // A change that waited may have removed the item or its target.
                    if (!resolvePath(`${gridPath}.${itemId}`) || !resolvePath(toPath)) return;
                    actions.moveItemBetweenGrids(gridPath, toPath, itemId, toPosition);
                    const tabs = panel?.parentElement;
                    const tabsPath = tabs && sortablePaths.get(tabs);
                    if (panel?.dataset.id && tabsPath) selectedTabSignal(tabsPath).value = panel.dataset.id;
                }
                const { layouts, ids } = stateLayouts(toPath);
                const positions = positionsAfterDrop(dropped, layouts, ids);
                if (!samePositions(positions, layouts)) actions.positionsChanged(toPath, positions);
            };

            // Thawed, the grids render once, with the drop and what changed meanwhile.
            batch(() => {
                for (const op of thawGrid(freezePath)) op();
                drop();
            });
        };

        const instances = columnsOf(grid).map(col => Sortable.create(col, {
            group,
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
            sortablePaths.delete(grid);
            instances.forEach(s => s.destroy());
            stopHover?.();
            // A grid unmounted mid-drag (its tab deleted) lets the changes through.
            if (origin && isFrozen(freezePath)) {
                for (const op of thawGrid(freezePath)) op();
            }
        };
    }, [gridPath, itemClass, columns, flat, enabled, freezePath, group]);
}
