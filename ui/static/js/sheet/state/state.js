import { domToSignals } from "./builder.js";
import { attachComputeds } from "./computed.js";
import { resetItemVersions } from "./sync.js";
import { normalizeSheet } from "../schema/normalize";
import { jsonToSignals } from "./fromJson";
import { readSheetState } from "./sheetState";
import { compareTrees, formatDiff } from "./reconcile";

/**
 * Populated once by initState(), then imported by computed.js and consumers.
 */
export let characterState = {};

/**
 * Build the signal tree from the sheet JSON, then attach computeds.
 * @param {Element} root - The shadow root or document root containing the sheet.
 */
export function initState(root) {
    // Clear all existing keys so stale state from a previous sheet doesn't bleed through
    for (const key of Object.keys(characterState)) {
        delete characterState[key];
    }
    resetItemVersions();

    const ghosts = [];
    const content = normalizeSheet(readSheetState().content, {
        onGhost: (gridPath, id) => ghosts.push(`${gridPath}.${id}`),
    });
    const tree = jsonToSignals(content);

    if (__DEV__) {
        if (ghosts.length) console.warn("normalizeSheet: dropped layouts of missing items", ghosts);
        // Before mountBindings, the markup still shows what the server rendered.
        reportMarkupMismatch(root, tree, ghosts);
    }

    Object.assign(characterState, tree);
    attachComputeds(tree);
    console.log(characterState)
}

/** Dev-only: compares the JSON state with the state scanned from the markup. */
function reportMarkupMismatch(root, tree, ghosts) {
    const diffs = compareTrees(domToSignals(root), tree, ghosts).filter(d => !d.ghost);
    if (diffs.length) {
        console.warn(`Sheet state from JSON differs from the markup in ${diffs.length} fields:\n`
            + diffs.map(formatDiff).join("\n"));
    }
}
