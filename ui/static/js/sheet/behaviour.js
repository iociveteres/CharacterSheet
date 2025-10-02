import {
    getRoot,
    getLeafFromPath,
    findElementByPath,
    applyBatch,
    applyPositions,
} from "./utils.js"

export function makeDeletable(itemOrGrid) {
    const container = itemOrGrid instanceof Element
        ? itemOrGrid
        : itemOrGrid.container;
    let deletionMode = false;

    let toggleButton = container.querySelector('.toggle-delete-mode');

    if (!toggleButton) {
        const controls = container.querySelector('.controls-block');
        toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-delete-mode';
        toggleButton.textContent = 'Delete Mode';
        controls.appendChild(toggleButton);
    }

    toggleButton.addEventListener('click', () => {
        deletionMode = !deletionMode;
        container.classList.toggle('deletion-mode', deletionMode);
    });
}


// TO DO: Use bundler
import { nanoid } from 'https://cdn.jsdelivr.net/npm/nanoid/nanoid.js'

export function createIdCounter() {
    // Return the closure that gives you the next ID
    return function () {
        return nanoid();
    };
}

export function nanoidWrapper() {
    return nanoid();
}


export function setupToggleAll(itemGridInstance) {
    const { container, cssClassName } = itemGridInstance;

    let toggleButton = container.querySelector('.toggle-all');

    if (!toggleButton) {
        const controls = container.querySelector('.controls-block');
        toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-all';
        toggleButton.textContent = 'Toggle All';
        controls.appendChild(toggleButton);
    }

    toggleButton.addEventListener("click", () => {
        const shouldOpen = Array.from(
            container.querySelectorAll(".split-description:not(:placeholder-shown)")
        ).some((ta) => !ta.classList.contains("visible"));

        const sel = shouldOpen
            ? `${cssClassName}:has(.split-description:not(:placeholder-shown)):not(:has(.split-description.visible))`
            : `${cssClassName}:has(.split-description.visible)`;

        container.querySelectorAll(sel).forEach((item) => {
            item.dispatchEvent(
                new CustomEvent("split-toggle", { detail: { open: shouldOpen } })
            );
        });
    });
}

export function setupGlobalAddButton(itemGridInstance) {
    const { container, cssClassName, _createNewItem } = itemGridInstance;

    let addButton = container.querySelector('.add-one');

    if (!addButton) {
        const controls = container.querySelector('.controls-block');
        addButton = document.createElement('button');
        addButton.className = 'add-one';
        addButton.textContent = '+ Add';
        controls.appendChild(addButton);
    }

    addButton.addEventListener("click", () => {
        const wrappers = Array.from(
            container.querySelectorAll(".layout-column-wrapper")
        );

        let target = null;
        let min = Infinity;

        wrappers.forEach((wrapper) => {
            const col = wrapper.querySelector(".layout-column");
            const count = col.querySelectorAll(cssClassName).length;
            if (count < min) {
                min = count;
                target = col;
            }
        });

        if (target) _createNewItem.call(itemGridInstance, {column: target});
    });
}


export function setupColumnAddButtons(itemGridInstance) {
    const { container, _createNewItem } = itemGridInstance;

    container.querySelectorAll('.add-slot').forEach(slot => {
        let btn = slot.querySelector('.add-button');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'add-button';
            btn.textContent = '＋ Add';
            slot.appendChild(btn);
        }

        if (!btn.dataset.handlerAttached) {
            btn.addEventListener('click', () => {
                const column = btn.closest('.layout-column');
                if (column) {
                    _createNewItem.call(itemGridInstance, {column});
                }
            });
            btn.dataset.handlerAttached = 'true';
        }
    });
}


export function makeSortable(itemGridInstance) {
    const { container, sortableChildrenSelectors } = itemGridInstance;

    const cols = container.querySelectorAll(".layout-column");
    cols.forEach((col) => {
        new Sortable(col, {
            group: container.id,
            handle: ".drag-handle",
            animation: 150,
            filter: sortableChildrenSelectors,
            ghostClass: "sortable-ghost",
            onEnd: itemGridInstance._onSortEnd.bind(itemGridInstance)
        });
    });
}

/**
 * Syncs local create-item events on a container to the server
 *
 * @param {Element} container
 * @param {{ socket: WebSocket }} options
 */
export function initCreateItemSender(container, { socket }) {
    container.addEventListener('createItemLocal', e => {
        const { itemId, itemPos, init, path } = e.detail || {};

        const msg = {
            type: 'createItem',
            eventID: crypto.randomUUID(),
            sheetID: document.getElementById('charactersheet')?.dataset.sheetId || null,
            path,
            itemId,
            itemPos,
            init,
        };

        socket.send(JSON.stringify(msg));
    });
}


/**
 * Syncs local delete-item events on a container to the server
 *
 * @param {Element} container
 * @param {{ socket: WebSocket }} options
 */
export function initDeleteItemSender(container, { socket }) {
    container.addEventListener('deleteItemLocal', e => {
        const { itemId, path } = e.detail || {};

        const msg = {
            type: 'deleteItem',
            eventID: crypto.randomUUID(),
            sheetID: document.getElementById('charactersheet')?.dataset.sheetId || null,
            path: path + "." + itemId,
        };

        socket.send(JSON.stringify(msg));
    });
}

export function initCreateItemHandler(itemGridInstance) {
    const { container, _createNewItem } = itemGridInstance;
    container.addEventListener('createItemRemote', e => {
        const { itemId, itemPos, init } = e.detail;

        let column = null;
        if (itemPos?.colIndex != null) {
            column = container.querySelector(`[data-column="${itemPos.colIndex}"]`);
        }
        _createNewItem.call(itemGridInstance, {column, forcedId: itemId, init});
    });
}


export function initDeleteItemHandler(itemGridInstance) {
    const { container } = itemGridInstance;
    container.addEventListener('deleteItemRemote', e => {
        const { path } = e.detail;
        const leaf = getLeafFromPath(path)
        container.querySelector(`[data-id="${leaf}"]`).remove();
    });
}


export function initPositionsChangedHandler(itemGridInstance) {
    const { container } = itemGridInstance;
    container.addEventListener('positionsChangedRemote', e => {
        const { path, positions } = e.detail;
        const el = findElementByPath(path);
        applyPositions(el, positions);
    });
}


export function initChangeHandler() {
    getRoot().addEventListener('changeRemote', e => {
        const { path, change } = e.detail;
        const el = findElementByPath(path)
        el.value = change;
    });
}


export function initBatchHandler() {
    getRoot().addEventListener('batchRemote', e => {
        const { path, changes } = e.detail;
        const el = findElementByPath(path);
        applyBatch(el, changes);
    });
}

