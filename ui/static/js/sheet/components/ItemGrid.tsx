import { Fragment, type VNode } from "preact";
import { useRef } from "preact/hooks";
import { nanoid } from "nanoid";
import { gridSpecOf, newItemAt } from "../state/fromJson";
import { isRenderFrozen } from "../state/dragFreeze";
import { columnsFromLayout } from "./columns";
import { joinPath, usePath, useSheet } from "./context";
import { Scope } from "./Scope";
import { useItemIds } from "./useItemIds";
import { useSortable, type SortableOptions } from "./useSortable";

export interface ItemGridProps {
    /** The grid's data-id: "conditions.list.items" at the top, "entries.items" inside an item. */
    dataId: string;
    /** The DOM id, e.g. "conditions". */
    id?: string;
    /** Classes next to item-grid. */
    class?: string;
    /** Classes next to layout-column. */
    columnClass?: string;
    /** Class of an item's root element; Sortable drags those by their .drag-handle. */
    itemClass: string;
    /** Renders the item with this id; its root must be a Scope with dataId={id}. */
    renderItem: (id: string) => VNode;
    /** The init of new items; newItemOf the grid's item schema by default. */
    newItem?: () => object;
    /** New item ids are `${idPrefix}-${nanoid()}`, like the DOM id prefix of old grids. */
    idPrefix?: string;
    /** Items can be dragged between the grids of this group, see useSortable. */
    shared?: SortableOptions["shared"];
}

/**
 * A grid of items in columns, ordered by the grid's layouts. Every column
 * ends with an add button. Delete Mode stays the deletion-mode class on the
 * sheet container. Items are keyed by id, so a reorder moves their DOM nodes.
 */
export function ItemGrid({ dataId, id, class: cls, columnClass, itemClass, renderItem, newItem, idPrefix, shared }: ItemGridProps) {
    const { canEdit, actions } = useSheet();
    const gridPath = joinPath(usePath(), dataId);
    const columns = gridSpecOf(gridPath)?.columns ?? 1;
    const { ids, layouts } = useItemIds(gridPath);
    const cols = columnsFromLayout(columns, layouts, ids);
    const gridRef = useRef<HTMLElement>(null);
    useSortable(gridRef, { gridPath, itemClass, columns, enabled: canEdit, actions, shared });
    const lastColumns = useRef<VNode[] | null>(null);

    const add = (colIndex: number) => {
        const itemId = `${idPrefix ?? id ?? "item"}-${nanoid()}`;
        actions.createItem(gridPath, itemId, newItem ? newItem() : newItemAt(gridPath), { colIndex, rowIndex: cols[colIndex].length });
    };

    // During a drag Sortable owns the columns' children. The same vnodes as
    // last time make Preact skip them; item contents still update. A drag
    // between grids (powers between tabs) freezes every grid it can drop into.
    let columnNodes = lastColumns.current;
    if (!isRenderFrozen(gridPath) || !columnNodes) {
        columnNodes = cols.map((colIds, c) => (
            <div key={c} class={columnClass ? `layout-column ${columnClass}` : "layout-column"} data-column={c}>
                {colIds.map(itemId => <Fragment key={itemId}>{renderItem(itemId)}</Fragment>)}
                <div class="add-slot">
                    {canEdit && <button class="add-button" onClick={() => add(c)}>＋ Add</button>}
                </div>
            </div>
        ));
        lastColumns.current = columnNodes;
    }

    return (
        <Scope dataId={dataId} id={id} class={cls ? `item-grid ${cls}` : "item-grid"} elRef={gridRef}>
            {columnNodes}
        </Scope>
    );
}
