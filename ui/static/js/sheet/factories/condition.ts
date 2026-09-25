// New conditions and entries. The createItem message carries this object as
// init, so every client builds the same item from it, entry ids included.
import { nanoid } from "nanoid";
import type { Condition, ConditionEntry } from "../schema/content.gen";

export function conditionEntryFactory(): ConditionEntry {
    return { type: "char_bonus", name: "" };
}

/** A condition starts enabled, with one stack and one entry. */
export function conditionFactory(): Condition {
    const entryId = `entry-${nanoid()}`;
    return {
        enabled: true,
        name: "",
        stacks: 1,
        entries: {
            items: { [entryId]: conditionEntryFactory() },
            layouts: { [entryId]: { colIndex: 0, rowIndex: 0 } },
        },
    };
}
