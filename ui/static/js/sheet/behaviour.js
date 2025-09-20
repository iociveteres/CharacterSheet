import {
    getRoot
} from "./utils.js"

export function makeDeletable(itemOrGrid) {
    const grid = itemOrGrid instanceof Element
        ? itemOrGrid
        : itemOrGrid.grid;
    let deletionMode = false;

    let toggleButton = grid.querySelector('.toggle-delete-mode');

    if (!toggleButton) {
        const controls = grid.querySelector('.controls-block');
        toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-delete-mode';
        toggleButton.textContent = 'Delete Mode';
        controls.appendChild(toggleButton);
    }

    toggleButton.addEventListener('click', () => {
        deletionMode = !deletionMode;
        grid.classList.toggle('deletion-mode', deletionMode);
    });
}


// TO DO: Use bundler
import { nanoid } from 'https://cdn.jsdelivr.net/npm/nanoid/nanoid.js'

export function createIdCounter(gridEl, itemSelector) {
    // Return the closure that gives you the next ID
    return function () {
        return nanoid();
    };
}

export function nanoidWrapper() {
    return nanoid();
}


export function setupToggleAll(itemGridInstance) {
    const { grid, cssClassName } = itemGridInstance;

    let toggleButton = grid.querySelector('.toggle-all');

    if (!toggleButton) {
        const controls = grid.querySelector('.controls-block');
        toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-all';
        toggleButton.textContent = 'Toggle All';
        controls.appendChild(toggleButton);
    }

    toggleButton.addEventListener("click", () => {
        const shouldOpen = Array.from(
            grid.querySelectorAll(".split-description:not(:placeholder-shown)")
        ).some((ta) => !ta.classList.contains("visible"));

        const sel = shouldOpen
            ? `${cssClassName}:has(.split-description:not(:placeholder-shown)):not(:has(.split-description.visible))`
            : `${cssClassName}:has(.split-description.visible)`;

        grid.querySelectorAll(sel).forEach((item) => {
            item.dispatchEvent(
                new CustomEvent("split-toggle", { detail: { open: shouldOpen } })
            );
        });
    });
}

export function setupGlobalAddButton(itemGridInstance) {
    const { grid, cssClassName, _createNewItem } = itemGridInstance;

    let addButton = grid.querySelector('.add-one');

    if (!addButton) {
        const controls = grid.querySelector('.controls-block');
        addButton = document.createElement('button');
        addButton.className = 'add-one';
        addButton.textContent = '+ Add';
        controls.appendChild(addButton);
    }

    addButton.addEventListener("click", () => {
        const wrappers = Array.from(
            grid.querySelectorAll(".layout-column-wrapper")
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

        if (target) _createNewItem.call(itemGridInstance, target);
    });
}


export function setupColumnAddButtons(itemGridInstance) {
    const { grid, _createNewItem } = itemGridInstance;

    grid.querySelectorAll('.add-slot').forEach(slot => {
        let btn = slot.querySelector('.add-button');
        if (!btn) {
            btn = document.createElement('button');
            btn.className = 'add-button';
            btn.textContent = '＋ Add';
            slot.appendChild(btn);
        }

        if (!btn.dataset.handlerAttached) {
            btn.addEventListener('click', () => {
                const col = btn.closest('.layout-column');
                if (col) {
                    _createNewItem.call(itemGridInstance, col);
                }
            });
            btn.dataset.handlerAttached = 'true';
        }
    });
}


export function makeSortable(itemGridInstance) {
    const { grid, sortableChildrenSelectors } = itemGridInstance;

    const cols = grid.querySelectorAll(".layout-column");
    cols.forEach((col) => {
        new Sortable(col, {
            group: grid.id,
            handle: ".drag-handle",
            animation: 150,
            filter: sortableChildrenSelectors,
            ghostClass: "sortable-ghost",
            onEnd: itemGridInstance._onSortEnd.bind(itemGridInstance)
        });
    });
}

/**
 * Syncs *local* create‐item events on a container to the server.
 *
 * @param {Element} container
 * @param {{ socket: WebSocket }} options
 */
export function initCreateItemSender(container, { socket }) {
    container.addEventListener('createItemLocal', e => {
        const { itemId, itemPos, itemPath, init } = e.detail;
        let addedPath = ""
        if (itemPath != null)
            addedPath = "." + itemPath
        socket.send(JSON.stringify({
            type: 'createItem',
            sheetID: document.getElementById('charactersheet').dataset.sheetId,
            path: container.id + addedPath,
            itemId,
            itemPos,
            init
        }));
    });
}


/**
 * Hooks up a handler for `createItemRemote` on a container.
 *
 * @param {Element} container
 * @param {(itemId: string) => void} onRemoteCreate — called with the new itemId
 */
export function initCreateItemHandler(container, onRemoteCreate) {
    container.addEventListener('createItemRemote', e => {
        onRemoteCreate(e.detail.itemId);
    });
}


/**
 * Syncs *local* delete-item events on a container by logging what would have been sent.
 *
 * @param {Element} grid
 * @param {{ socket: { send: (msg:string)=>void } }} options
 */
export function initDeleteItemSender(grid, { socket }) {
    grid.addEventListener('deleteItemLocal', e => {
        const { itemId } = e.detail;
        const msgObj = {
            type: 'deleteItem',
            sheetId: document.getElementById('charactersheet').dataset.sheetId,
            path: grid.id + '.' + itemId,
        };
        const msg = JSON.stringify(msgObj);
        socket.send(msg);
    });
}

/**
 * Hooks up a handler for `remote-delete-item` on a container
 * that logs when it fires, then calls your real handler.
 *
 * @param {Element} container
 * @param {(itemId: string) => void} onRemoteDelete — called with the deleted itemId
 */
export function initDeleteItemHandler(container, onRemoteDelete) {
    container.addEventListener('deleteItemRemote', e => {
        onRemoteDelete(e.detail.itemId);
    });
}
