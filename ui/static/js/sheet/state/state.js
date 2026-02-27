import { domToSignals } from "./builder.js";
import { attachComputeds } from "./computed.js";

/**
 * Populated once by initState(), then imported by computed.js and consumers.
 */
export let characterState = {};

/**
 * Build signal tree from the fully-rendered DOM, then attach computeds.
 * @param {Element} root - The shadow root or document root containing the sheet.
 */
export function initState(root) {
    const tree = domToSignals(root);
    Object.assign(characterState, tree);
    attachComputeds(tree);
    console.log(characterState)
}