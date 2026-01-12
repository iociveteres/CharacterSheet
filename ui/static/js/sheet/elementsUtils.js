import {
    getDataPathParent
} from "./utils.js"


/**
 * Attach toggle behavior to show/hide collapsible content
 * @param {Element} container - Parent element containing toggle and content
 * @param {{toggle: string, content: string}} selectors
 */
export function initToggleContent(container, { toggle: toggleSelector, content: contentSelector }) {
    const toggle = container.querySelector(toggleSelector);
    const content = container.querySelector(contentSelector);
    if (!toggle || !content) {
        throw new Error(`initToggleContent: missing element (${toggleSelector} or ${contentSelector})`);
    }

    setInitialCollapsedState(container);

    toggle.addEventListener('click', () => {
        container.classList.toggle('collapsed');
    });
}

/**
 * Check if an item has any content in its collapsible area
 * @param {Element} container - The item container
 * @returns {boolean}
 */
export function hasCollapsibleContent(container) {
    const description = container.querySelector('.split-description');
    const hasDescription = description && description.value.trim() !== '';

    const collapsibleContent = container.querySelector('.collapsible-content');
    if (!collapsibleContent) return hasDescription;

    const hasOtherContent = Array.from(
        collapsibleContent.querySelectorAll('input:not(.split-description), select, textarea:not(.split-description)')
    ).some(field => {
        if (field.type === 'checkbox') return field.checked;
        if (field.type === 'radio') return field.checked;
        return field.value && field.value.trim() !== '';
    });

    return hasDescription || hasOtherContent;
}

/**
 * Set initial collapsed state based on whether item has content
 * Items with content start collapsed, empty items start expanded
 * @param {Element} container - The item container
 */
export function setInitialCollapsedState(container) {
    if (!hasCollapsibleContent(container)) {
        container.classList.add('collapsed');
    }
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
        const path = getDataPathParent(container)
        grid.dispatchEvent(new CustomEvent('deleteItemLocal', {
            bubbles: true,
            detail: { itemId, path }
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
            const trimmed = text.trim();
            if (!trimmed) return; // Empty text - allow default paste behavior
            if (!trimmed.includes('\n')) return; // Single line text - allow default paste behavior

            e.preventDefault();
            const changes = callback(text, target);

            // if element has .split-description, show it
            const textarea = container.querySelector(".split-description");
            if (textarea && textarea.value.trim() !== "") {
                textarea.classList.add('visible');
            }

            // Dispatch synthetic event with changes
            if (changes && typeof changes === 'object' && Object.keys(changes).length > 0) {
                container.dispatchEvent(new CustomEvent("fieldsUpdated", {
                    bubbles: true,
                    detail: { changes }
                }));
            }
        }
    });
}

export function createDragHandle() {
    const handle = document.createElement("div");
    handle.className = "drag-handle";
    return handle;
} export function createDeleteButton() {
    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    return deleteButton;
}
export function createToggleButton() {
    const toggleButton = document.createElement("button");
    toggleButton.className = "toggle-button";
    return toggleButton;
}
export function createTextArea() {
    const ta = document.createElement("textarea");
    ta.className = "split-description";
    ta.placeholder = " ";
    return ta;
}

export function applyPayload(container, payload) {
    Object.entries(payload).forEach(([path, value]) => {
        const el = container.querySelector(`[data-id="${path}"]`);
        if (el) {
            // select vs input doesn’t matter; both have .value
            el.value = value;
        }
    });
}