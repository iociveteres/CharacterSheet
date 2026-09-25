import { useSheet } from "./context";

/** The handle Sortable drags an item by. Hidden without edit rights. */
export function DragHandle() {
    const { canEdit } = useSheet();
    return canEdit ? <div class="drag-handle" /> : null;
}

/** Deletes the item at `itemPath`. CSS shows it only in Delete Mode. */
export function DeleteButton({ itemPath }: { itemPath: string }) {
    const { canEdit, actions } = useSheet();
    if (!canEdit) return null;
    return <button class="delete-button" type="button" onClick={() => actions.deleteItem(itemPath)} />;
}
