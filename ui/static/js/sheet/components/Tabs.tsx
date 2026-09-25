import { Fragment, type ComponentChildren } from "preact";
import { nanoid } from "nanoid";
import { selectedTabSignal } from "../state/ui";
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
    /** The init of new tabs; the schema fills in what it leaves out. */
    newItem?: () => object;
    idPrefix?: string;
    addLabel?: string;
}

/**
 * Tabs as the old markup has them: radio, label and panel per tab, all
 * panels mounted and hidden by CSS (.radiotab:checked + .tablabel + .panel).
 * Dragging an item over a label checks its radio and fires change, which
 * opens the tab, and the grid in the hidden panel is there to drop into.
 * The label and the panel share the tab's data-id, so both extend its path.
 */
export function Tabs({ dataId, group, class: cls, renderLabel, renderPanel, newItem = () => ({}), idPrefix = "tab", addLabel = "+" }: TabsProps) {
    const { canEdit, actions } = useSheet();
    const tabsPath = joinPath(usePath(), dataId);
    const { ids, layouts } = useItemIds(tabsPath);
    const order = columnsFromLayout(1, layouts, ids)[0];
    const selected = selectedTabSignal(tabsPath);

    // A deleted open tab leaves the last one open, as the old Tabs did.
    const current = selected.value === null
        ? order[0]
        : order.includes(selected.value) ? selected.value : order[order.length - 1];

    const add = () => {
        const id = `${idPrefix}-${nanoid()}`;
        actions.createItem(tabsPath, id, newItem(), { colIndex: 0, rowIndex: order.length });
        selected.value = id;
    };

    return (
        <Scope dataId={dataId} class={cls ? `tabs ${cls}` : "tabs"}>
            {order.map(id => (
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
            ))}
            {canEdit && <button type="button" class="add-tab-btn" onClick={add}>{addLabel}</button>}
        </Scope>
    );
}
