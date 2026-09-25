import { Fragment, type ComponentChildren, type RefObject, type VNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { batch, type Signal } from "@preact/signals-core";
import { nanoid } from "nanoid";
import Sortable from "sortablejs";
import { freezeGrid, isFrozen, thawGrid } from "../state/dragFreeze";
import { resolvePath } from "../state/sync.js";
import type { SheetActions } from "../state/actions";
import type { Position } from "../schema/content.gen";
import { positionsAfterDrop } from "./useSortable";
import { selectedTabSignal } from "../state/ui";
import { newItemAt } from "../state/fromJson";
import { columnsFromLayout } from "./columns";
import { joinPath, usePath, useSheet } from "./context";
import { DeleteButton, DragHandle } from "./ItemControls";
import { Scope } from "./Scope";
import { useItemIds } from "./useItemIds";

export interface TabsProps {
    /** The data-id of the tab grid, e.g. "tabs.items". */
    dataId: string;
    /** Name of the radio group; unique on the sheet. */
    group: string;
    /** Classes next to tabs. */
    class?: string;
    /** Content of a tab's label, before its drag handle and delete button. */
    renderLabel: (id: string) => ComponentChildren;
    renderPanel: (id: string) => ComponentChildren;
    /** The init of new tabs; newItemOf the tab schema by default. */
    newItem?: () => object;
    idPrefix?: string;
    addLabel?: string;
}

type Positions = { [id: string]: Position };

/**
 * Makes the tab labels sortable by their drag handles. As with grids, the
 * tabs are frozen for the drag and the label goes back where it was on drop;
 * the new order goes into the layouts and Preact moves radio, label and
 * panel together. Returns a signal that is true during a drag.
 */
function useTabSorting(ref: RefObject<HTMLElement>, tabsPath: string, enabled: boolean, actions: SheetActions): Signal<boolean> {
    const dragging = useSignal(false);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !enabled) return;
        let origin: { parent: Node; next: Node | null } | null = null;

        const sortable = Sortable.create(el, {
            draggable: ".tablabel",
            handle: ".drag-handle",
            animation: 150,
            // The fallback clone stays inside the shadow root and gets the sheet's styles.
            forceFallback: true,
            fallbackTolerance: 3,
            onStart: evt => {
                origin = { parent: evt.item.parentNode!, next: evt.item.nextSibling };
                freezeGrid(tabsPath);
                dragging.value = true;
            },
            onEnd: evt => {
                if (!origin) return;
                const dropped = Array.from(el.querySelectorAll<HTMLElement>(":scope > .tablabel"))
                    .filter(label => !label.classList.contains("sortable-fallback"))
                    .map(label => label.dataset.id!);
                origin.parent.insertBefore(evt.item, origin.next);
                origin = null;

                batch(() => {
                    for (const op of thawGrid(tabsPath)) op();
                    const layouts = (resolvePath(tabsPath.replace(/items$/, "layouts")) as Signal<Positions> | null)?.value ?? {};
                    const items = resolvePath(tabsPath);
                    const ids = items && typeof items === "object" ? Object.keys(items) : [];
                    const positions = positionsAfterDrop([dropped], layouts, ids);
                    const moved = Object.keys(positions).some(id => layouts[id]?.rowIndex !== positions[id].rowIndex
                        || layouts[id]?.colIndex !== positions[id].colIndex);
                    if (moved) actions.positionsChanged(tabsPath, positions);
                    dragging.value = false;
                });
            },
        });

        return () => {
            sortable.destroy();
            if (isFrozen(tabsPath)) {
                for (const op of thawGrid(tabsPath)) op();
            }
            dragging.value = false;
        };
    }, [tabsPath, enabled]);

    return dragging;
}

/**
 * Tabs as the old markup has them: radio, label and panel per tab, all
 * panels mounted and hidden by CSS (.radiotab:checked + .tablabel + .panel).
 * Dragging an item over a label checks its radio and fires change, which
 * opens the tab, and the grid in the hidden panel is there to drop into.
 * The label and the panel share the tab's data-id, so both extend its path.
 */
export function Tabs({ dataId, group, class: cls, renderLabel, renderPanel, newItem, idPrefix = "tab", addLabel = "+" }: TabsProps) {
    const { canEdit, actions } = useSheet();
    const tabsPath = joinPath(usePath(), dataId);
    const { ids, layouts } = useItemIds(tabsPath);
    const order = columnsFromLayout(1, layouts, ids)[0];
    const selected = selectedTabSignal(tabsPath);
    const ref = useRef<HTMLElement>(null);
    const dragging = useTabSorting(ref, tabsPath, canEdit, actions);
    const lastTabs = useRef<VNode[] | null>(null);

    // A deleted open tab leaves the last one open, as the old Tabs did.
    const current = selected.value === null
        ? order[0]
        : order.includes(selected.value) ? selected.value : order[order.length - 1];

    const add = () => {
        const id = `${idPrefix}-${nanoid()}`;
        actions.createItem(tabsPath, id, newItem ? newItem() : newItemAt(tabsPath), { colIndex: 0, rowIndex: order.length });
        selected.value = id;
    };

    // During a drag Sortable owns the labels; the same vnodes make Preact skip them.
    let tabNodes = lastTabs.current;
    if (!dragging.value || !tabNodes) {
        tabNodes = order.map(id => (
            <Fragment key={id}>
                <input
                    type="radio"
                    class="radiotab"
                    name={group}
                    id={id}
                    checked={id === current}
                    onChange={() => { selected.value = id; }}
                />
                <Scope as="label" dataId={id} class="tablabel" for={id}>
                    {renderLabel(id)}
                    <DragHandle />
                    <DeleteButton itemPath={joinPath(tabsPath, id)} />
                </Scope>
                <Scope dataId={id} class="panel">{renderPanel(id)}</Scope>
            </Fragment>
        ));
        lastTabs.current = tabNodes;
    }

    return (
        <Scope dataId={dataId} class={cls ? `tabs ${cls}` : "tabs"} elRef={ref}>
            {tabNodes}
            {canEdit && <button type="button" class="add-tab-btn" onClick={add}>{addLabel}</button>}
        </Scope>
    );
}
