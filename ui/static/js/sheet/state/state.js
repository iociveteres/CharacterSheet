import { domToSignals } from "./builder.js";
import { attachComputeds } from "./computed.js";
import { resetItemVersions } from "./sync.js";

/**
 * Populated once by initState(), then imported by computed.js and consumers.
 */
export let characterState = {};

/**
 * Build signal tree from the fully-rendered DOM, then attach computeds.
 * @param {Element} root - The shadow root or document root containing the sheet.
 */
export function initState(root) {
    // Clear all existing keys so stale state from a previous sheet doesn't bleed through
    for (const key of Object.keys(characterState)) {
        delete characterState[key];
    }
    resetItemVersions();

    const tree = domToSignals(root);
    Object.assign(characterState, tree);
    attachComputeds(tree);
    console.log(characterState)
}