import {
    getRoot
} from "./utils.js"

/**
 * Traverse the DOM starting from `rootEl` (default: document.body) and build
 * a nested object whose keys are `data-id` values, preserving DOM order.
 *
 * - If `rootEl` itself has a `data-id`, the result is { [rootId]: {...} }.
 * - Otherwise, the result is an object where each key is a top-level `data-id`
 *   under `rootEl`, in the order those elements appear in the DOM.
 *
 * Containers (elements with children that also have `data-id`) become objects.
 * Leaf inputs/selects/textareas become string values.
 *
 * Example HTML:
 * <div data-id="characteristics">
 *   <div data-id="WS">
 *     <input data-id="value" value="30">
 *     <input data-id="unnatural" value="2">
 *   </div>
 *   <div data-id="BS">
 *     <input data-id="value" value="25">
 *   </div>
 * </div>
 *
 * getDataIdTree() → 
 * {
 *   "characteristics": {
 *     "WS": {
 *       "value": "30",
 *       "unnatural": "2"
 *     },
 *     "BS": {
 *       "value": "25"
 *     }
 *   }
 * }
 *
 * @param {HTMLElement} rootEl
 * @returns {Object}
 */
function getDataIdJSON(rootEl = document.body) {
    // 1) Gather all elements under rootEl that have data-id (including rootEl itself if it has one).
    const allWithId = Array.from(rootEl.querySelectorAll('[data-id]'));
    if (rootEl.dataset && rootEl.dataset.id) {
        allWithId.unshift(rootEl);
    }

    // 2) Build maps using element references as keys:
    //    - elToParent: element → its nearest ancestor element with data-id (or null if none under rootEl)
    //    - parentToChildren: element → array of its direct child elements (in DOM order)
    const elToParent = new Map();
    const parentToChildren = new Map();

    // Initialize parentToChildren entries for every element-with-id (and for `null` root).
    allWithId.forEach(el => {
        parentToChildren.set(el, []);
    });
    parentToChildren.set(null, []); // for true top-levels

    // Determine each element's parent element (nearest ancestor with data-id, stopping at rootEl).
    for (const el of allWithId) {
        let parent = el.parentElement;
        let found = null;
        while (parent && parent !== rootEl) {
            if (parent.dataset && parent.dataset.id) {
                found = parent;
                break;
            }
            parent = parent.parentElement;
        }
        // If rootEl itself has a data-id, only consider ancestors strictly above el and below rootEl.
        // If rootEl has no data-id, treating parent-of-root as null is fine.
        if (found) {
            elToParent.set(el, found);
        } else {
            elToParent.set(el, null);
        }
    }

    // Populate parentToChildren arrays in DOM order by iterating over allWithId
    for (const el of allWithId) {
        const p = elToParent.get(el); // may be null
        parentToChildren.get(p).push(el);
    }

    // Helper: is this a “leaf” (input/textarea/select) whose value we capture?
    function isLeaf(el) {
        const tag = el.tagName;
        return (
            (tag === 'INPUT' && el.type !== 'button' && el.type !== 'submit') ||
            tag === 'TEXTAREA' ||
            tag === 'SELECT'
        );
    }

    // 3) Recursive function: given an element EL, produce its subtree object/value.
    function buildNode(el) {
        // If EL is a leaf, return its .value string
        if (isLeaf(el)) {
            return el.value != null ? el.value : '';
        }
        // Otherwise, gather its direct children (from parentToChildren) in DOM order
        const result = {};
        const children = parentToChildren.get(el) || [];
        for (const childEl of children) {
            const key = childEl.dataset.id;
            result[key] = buildNode(childEl);
        }
        return result;
    }

    // 4) Assemble the final output object
    const output = {};

    // If rootEl itself has a data-id, return just that subtree
    if (rootEl.dataset && rootEl.dataset.id) {
        const rid = rootEl.dataset.id;
        output[rid] = buildNode(rootEl);
        return output;
    }

    // Otherwise, find top-level elements (those whose parent in elToParent is null)
    const topLevelEls = parentToChildren.get(null) || [];
    for (const el of topLevelEls) {
        const key = el.dataset.id;
        output[key] = buildNode(el);
    }

    return output;
}

function logJSON() {
    const tree = getDataIdJSON(getRoot());
    console.log(JSON.stringify(tree, null, 4));
}

document.addEventListener('charactersheet_inserted', e => {
    logJSON()
    const logJSONButton = getRoot().getElementById("log-json")
    logJSONButton.addEventListener('click', logJSON);
})
