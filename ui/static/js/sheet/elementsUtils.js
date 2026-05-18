import { getDataPath, getRoot, getDataPathParent, applyBatch } from "./utils.js";
import { resolvePath, createItemInState, deleteItemFromState } from "./state/sync.js";
import { mountBindings } from "./state/bindings.js";

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


/**
 * Wipe and rebuild a flat item grid's DOM and signals from a batch changes object.
 * Used by batchRemote interceptors (GearItem entries, ConditionItem entries, etc.)
 *
 * @param {HTMLElement} gridEl      - The .item-grid element (has _itemGridInstance set)
 * @param {string}      itemSelector - CSS selector for existing items to remove, e.g. '.condition-entry'
 * @param {object}      batchEntries - { items: {...}, layouts: {...} } from the batch changes
 */
export function rebuildGridFromBatch(gridEl, itemSelector, batchEntries) {
    const gridPath = getDataPath(gridEl);

    // 1) Clear stale signals
    const itemsNode = resolvePath(gridPath);
    if (itemsNode && typeof itemsNode === 'object') {
        for (const k of Object.keys(itemsNode)) delete itemsNode[k];
    }

    // 2) Remove existing item DOM without firing local events
    gridEl.querySelectorAll(itemSelector).forEach(el => el.remove());

    // 3) Recreate items in rowIndex order
    const col = gridEl.querySelector('.layout-column[data-column="0"]');
    const grid = gridEl._itemGridInstance;
    if (!col || !grid) return;

    const sorted = Object.entries(batchEntries.items).sort(([idA], [idB]) => {
        const ra = batchEntries.layouts?.[idA]?.rowIndex ?? 0;
        const rb = batchEntries.layouts?.[idB]?.rowIndex ?? 0;
        return ra - rb;
    });

    for (const [itemId, itemData] of sorted) {
        // Create the element with template defaults — do NOT pass init,
        // since ConditionEntryRow (and similar) ignores it.
        grid._createNewItem({ column: col, forcedId: itemId });

        // Populate DOM fields from batch data using the same mechanism
        // as initBatchHandler — applyBatch walks [data-id] elements and
        // sets form values from the plain object.
        const el = getRoot()?.querySelector(`[data-id="${itemId}"]`);
        if (el) {
            applyBatch(el, itemData);
            mountBindings(el);
        }

        createItemInState(gridPath, itemId, itemData);
    }
}