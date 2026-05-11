import {
    getDataPathParent
} from "./utils.js"

import {
    deleteItemFromState
} from "./state/sync.js"

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
export function initDelete(container, deleteSelector, onDelete = null) {
    const delBtn = container.querySelector(deleteSelector);
    if (!delBtn) {
        throw new Error(`initDelete: missing delete button (${deleteSelector})`);
    }

    delBtn.addEventListener('click', () => {
        // 1) cleanup before removal
        container.dispatchEvent(new CustomEvent('itemWillDelete', { bubbles: false }));

        // 2) dispatch the local-delete-item event for sync mixin
        const itemId = container.dataset.id;
        const grid = container.closest('.item-grid');
        const path = getDataPathParent(container);

        grid.dispatchEvent(new CustomEvent('deleteItemLocal', {
            bubbles: true,
            detail: { itemId, path }
        }));

        // 3) Clean up signal branch
        deleteItemFromState(path + '.' + itemId);

        // 4) Remove from DOM
        container.remove();
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

/**
 * Show/hide elements inside `container` reactively based on a select's value.
 *
 * @param {Element} container
 * @param {string} selectSelector - querySelector for the controlling select
 * @param {Record<string, string[] | (value: string) => boolean>} rules
 *   Keys are CSS selectors; values are either an array of select values that
 *   should make those elements visible, or a predicate function.
 * @param {string} [hiddenClass='field-hidden']
 */
export function setupConditionalFields(container, selectSelector, rules, hiddenClass = 'field-hidden') {
    const select = container.querySelector(selectSelector);
    if (!select) return;

    const apply = (value) => {
        for (const [selector, condition] of Object.entries(rules)) {
            const show = typeof condition === 'function'
                ? condition(value)
                : condition.includes(value);
            container.querySelectorAll(selector).forEach(el =>
                el.classList.toggle(hiddenClass, !show)
            );
        }
    };

    apply(select.value);
    select.addEventListener('change', () => apply(select.value));
}