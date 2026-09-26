// New conditions. The createItem message carries this object as init, so
// every client builds the same item from it, entry ids included.
import { nanoid } from "nanoid";
import { newItemOf, type NewItem } from "../schema/newItem";
import { condition, conditionEntry } from "../schema/sheet";

/** A new condition with one empty entry. */
export function conditionFactory(): NewItem<typeof condition> {
    const entryId = `entry-${nanoid()}`;
    return {
        ...newItemOf(condition),
        entries: {
            items: { [entryId]: newItemOf(conditionEntry) },
            layouts: { [entryId]: { colIndex: 0, rowIndex: 0 } },
        },
    };
}
