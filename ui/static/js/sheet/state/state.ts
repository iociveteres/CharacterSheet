import { deepSignal } from "deepsignal/core";
import { normalizeSheet } from "../schema/normalize";
import type { SheetSignals } from "../schema/sheet";
import type { SheetKindDef } from "../kinds/kind";
import { jsonToSignals, setSheetSchema } from "./fromJson";
import { resetUiState } from "./ui";
import { resetDragFreeze } from "./dragFreeze";

/**
 * Populated by initState(), then imported by computed.ts and consumers. The
 * objects of the tree are deepsignal proxies: reading a key, or the keys of an
 * object, subscribes to it, so adding and removing items notifies the readers.
 * The leaves are signals of their own. Write through the tree: a raw object
 * changed behind its proxy stays stale for readers, and `in` does not subscribe.
 * It is empty until the first initState().
 */
export const characterState = deepSignal({}) as SheetSignals;

/**
 * Build the signal tree from the sheet content with the schema of its kind,
 * then attach the kind's computeds.
 * @param rawContent - The content as the server stores it.
 * @param keepUi - The same sheet again: collapsed items and open tabs stay.
 */
export function initState(kind: SheetKindDef, rawContent: unknown, { keepUi = false } = {}): void {
    // Clear all existing keys so stale state from a previous sheet doesn't bleed through
    for (const key of Object.keys(characterState)) {
        delete (characterState as { [key: string]: unknown })[key];
    }
    if (!keepUi) resetUiState();
    resetDragFreeze();

    setSheetSchema(kind.schema);
    const ghosts: string[] = [];
    const content = normalizeSheet(kind.schema, rawContent, {
        onGhost: (gridPath, id) => ghosts.push(`${gridPath}.${id}`),
    });
    const tree = jsonToSignals(kind.schema, content);

    if (__DEV__ && ghosts.length) console.warn("normalizeSheet: dropped layouts of missing items", ghosts);

    Object.assign(characterState, tree);
    kind.attachComputeds(characterState);
}
