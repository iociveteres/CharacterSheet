import { attachComputeds } from "./computed.js";
import { resetItemVersions } from "./sync.js";
import { normalizeSheet } from "../schema/normalize";
import { jsonToSignals } from "./fromJson";
import { resetUiState } from "./ui";
import { resetDragFreeze } from "./dragFreeze";

/**
 * Populated once by initState(), then imported by computed.js and consumers.
 */
export let characterState = {};

/**
 * Build the signal tree from the sheet content, then attach computeds.
 * @param {unknown} rawContent - The content as the server stores it.
 */
export function initState(rawContent) {
    // Clear all existing keys so stale state from a previous sheet doesn't bleed through
    for (const key of Object.keys(characterState)) {
        delete characterState[key];
    }
    resetItemVersions();
    resetUiState();
    resetDragFreeze();

    const ghosts = [];
    const content = normalizeSheet(rawContent, {
        onGhost: (gridPath, id) => ghosts.push(`${gridPath}.${id}`),
    });
    const tree = jsonToSignals(content);

    if (__DEV__ && ghosts.length) console.warn("normalizeSheet: dropped layouts of missing items", ghosts);

    Object.assign(characterState, tree);
    attachComputeds(tree);
}
