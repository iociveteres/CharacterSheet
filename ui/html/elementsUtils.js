/**
 * Attach toggle behavior to show/hide a textarea
 * @param {Element} container - Parent element containing toggle and textarea
 * @param {{toggle: string, textarea: string}} selectors
 */
export function initToggleTextarea(container, { toggle: toggleSelector, textarea: textareaSelector }) {
    const toggle = container.querySelector(toggleSelector);
    const textarea = container.querySelector(textareaSelector);
    if (!toggle || !textarea) {
        throw new Error(`initToggle: missing element (${toggleSelector} or ${textareaSelector})`);
    }
    toggle.addEventListener('click', () => textarea.classList.toggle('visible'));
}

/**
 * Attach delete-button behavior to remove the container on click
 * @param {Element} container - Parent element containing delete button
 * @param {string} deleteSelector - Selector for delete button
 */
export function initDelete(container, deleteSelector) {
    const delBtn = container.querySelector(deleteSelector);
    if (!delBtn) {
        throw new Error(`initDelete: missing delete button (${deleteSelector})`);
    }
    delBtn.addEventListener('click', () => {
        // 1) dispatch the local-delete-item event for your sync mixin
        const itemId = container.dataset.id;
        const grid = container.closest('.item-grid');
        grid.dispatchEvent(new CustomEvent('local-delete-item', {
            bubbles: true,
            detail: { itemId }
        }));

        // 2) remove the DOM element
        container.remove();
    });
}

/**
 * Initialize a paste handler that intercepts paste events
 * on a specific field and runs a callback with the pasted text.
 * 
 * @param {Element} container - The container to listen on.
 * @param {string} targetDataId - The `data-id` of the field to target (e.g. "name").
 * @param {(text: string, target: Element) => void} callback - Function to call with pasted text.
 */
export function initPasteHandler(container, targetDataId, callback) {
    container.addEventListener('paste', e => {
        const text = (e.clipboardData || window.clipboardData).getData('text');
        const target = e.target;

        if (target?.dataset?.id === targetDataId) {
            e.preventDefault();
            const changes = callback(text, target);

            // if element has .split-description, show it
            const textarea = container.querySelector(".split-description");
            if (textarea) {
                textarea.classList.toggle('visible');
            }

            // Dispatch synthetic event with changes
            if (Array.isArray(changes) && changes.length > 0) {
                container.dispatchEvent(new CustomEvent("fields-updated", {
                    bubbles: true,
                    detail: { changes }
                }));
            }
        }
    });
}