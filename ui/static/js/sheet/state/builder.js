import { signal } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { getDataPath } from "../utils.js";

/**
 * Build a signal tree by scanning all writable inputs in the DOM.
 * This is the primary way initial state is built — the server has already
 * rendered every field with correct values (defaults or saved data), so
 * there is no sparse-JSON problem.
 *
 * Readonly elements are skipped: attachComputeds() will place computed
 * signals at those paths afterwards.
 */
export function domToSignals(root) {
    const tree = {};

    root.querySelectorAll('input[data-id], select[data-id], textarea[data-id]').forEach(el => {
        if (el.hasAttribute('readonly')) return; // computed outputs
        if (el.type === 'radio' && !el.checked) return; // only checked radio sets the signal

        const path = getDataPath(el);
        if (!path) return;

        const value = el.type === 'checkbox' ? el.checked
            : el.type === 'number' ? (Number(el.value) || 0)
                : el.value;

        setAtPath(tree, path.split('.'), value);
    });

    return tree;
}

/** Recursively set a signal at a nested path, creating plain objects as needed. */
function setAtPath(obj, segs, value) {
    const [head, ...tail] = segs;
    if (tail.length === 0) {
        obj[head] = signal(value);
    } else {
        if (!obj[head] || typeof obj[head] !== 'object') obj[head] = {};
        setAtPath(obj[head], tail, value);
    }
}