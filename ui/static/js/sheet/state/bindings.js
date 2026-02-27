import { effect } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { getDataPath } from "../utils.js";
import { resolvePath } from "./sync.js";

/**
 * Mount one-way reactive bindings: signal → DOM.
 * 
 * DOM → signal updates are handled by the existing input event system.
 * This function ONLY handles the reverse direction: when a signal changes,
 * update the DOM element displaying it.
 * 
 * Uses your existing data-id path system via getDataPath from utils.js.
 * 
 * HTML examples:
 *   <input data-id="value" name="characteristics.WS.value" />          <!-- writable -->
 *   <input data-id="calculatedValue" readonly />                       <!-- computed -->
 *   <input data-id="difficulty" readonly />                            <!-- computed -->
 *   <input data-id="total" readonly />                                 <!-- computed -->
 */
export function mountBindings(root) {
    // Find all inputs/selects/textareas with data-id
    const elements = root.querySelectorAll('input[data-id], select[data-id], textarea[data-id]');

    for (const el of elements) {
        const path = getDataPath(el); // Use existing path resolver
        if (!path) continue;

        const node = resolvePath(path);
        if (!node || typeof node.value === 'undefined') continue;

        // Create one-way binding: signal → DOM
        // This runs whenever the signal changes (from any source)
        effect(() => {
            const v = node.value;
            if (el.type === 'checkbox') {
                if (el.checked !== !!v) el.checked = !!v;
            } else if (el.type === 'radio') {
                const should = el.value === String(v ?? '');
                if (el.checked !== should) el.checked = should;
            } else if (el.value !== String(v ?? '')) {
                el.value = v ?? '';
            }
        });
    }
}