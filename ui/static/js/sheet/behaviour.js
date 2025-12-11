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


export function setupToggleAll(containerElement) {
    let toggleButton = containerElement.querySelector('.toggle-descriptions');

    if (!toggleButton) {
        const controls = containerElement.querySelector('.controls-block');
        toggleButton = document.createElement('button');
        toggleButton.className = 'toggle-descriptions';
        toggleButton.textContent = 'Toggle Descs';
        controls.appendChild(toggleButton);
    }

    toggleButton.addEventListener("click", () => {
        const shouldOpen = Array.from(
            containerElement.querySelectorAll(".split-description:not(:placeholder-shown)")
        ).some((ta) => !ta.classList.contains("visible"));

        const selector = shouldOpen
            ? ".item-with-description:has(.split-description:not(:placeholder-shown):not(.visible))"
            : ".item-with-description:has(.split-description.visible)";

        containerElement.querySelectorAll(selector).forEach((item) => {
            item.dispatchEvent(
                new CustomEvent("split-toggle", {
                    detail: { open: shouldOpen },
                    bubbles: true
                })
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

        if (target) _createNewItem.call(itemGridInstance, { column: target });
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
                    _createNewItem.call(itemGridInstance, { column });
                }
            });
            btn.dataset.handlerAttached = 'true';
        }
    });
}

export function setupSplitToggle(itemGridInstance) {
    const { container } = itemGridInstance;

    // Use event delegation on the container
    container.addEventListener('split-toggle', (e) => {
        // e.target will be the .item-with-description that received the event
        const item = e.target;
        const descEl = item.querySelector('.split-description');

        if (!descEl) return;

        if (e.detail.open) {
            descEl.classList.add("visible");
        } else {
            descEl.classList.remove("visible");
        }

        // Stop propagation so parent containers don't also handle it
        e.stopPropagation();
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
        _createNewItem.call(itemGridInstance, { column, forcedId: itemId, init });
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
        const el = findElementByPath(path);
        el.value = change;

        // Handle skill field changes
        const skillsOrCustomSkills = el.closest('#skills, #custom-skills');
        if (skillsOrCustomSkills) {
            const isMiscBonus = el.matches('input[data-id="misc-bonus"]');
            const isCheckbox = el.type === 'checkbox';
            if (isMiscBonus || isCheckbox) {
                const row = el.closest('tr, .custom-skill');
                if (row) {
                    row.dispatchEvent(new CustomEvent('skillRecalculate', { bubbles: true }));
                }
            }
        }

        // Handle characteristic changes
        const characteristicBlock = el.closest('.characteristic-block');
        if (characteristicBlock && el.matches('input.attribute')) {
            const charId = characteristicBlock.dataset.id;
            const skillsBlock = getRoot().getElementById('skills');
            if (skillsBlock) {
                skillsBlock.querySelectorAll(
                    'tr:has(input[data-id="difficulty"]), div.custom-skill'
                ).forEach((row) => {
                    const sel = row.querySelector('select[data-id="characteristic"]');
                    if (sel && sel.value === charId) {
                        row.dispatchEvent(new CustomEvent('skillRecalculate', { bubbles: true }));
                    }
                });
            }
        }
    });
}


export function initBatchHandler() {
    getRoot().addEventListener('batchRemote', e => {
        const { path, changes } = e.detail;
        const el = findElementByPath(path);
        applyBatch(el, changes);

        if (el.closest('#skills, #custom-skills')) {
            const row = el.closest('tr, .custom-skill');
            if (row) {
                row.dispatchEvent(new CustomEvent('skillRecalculate', { bubbles: true }));
            }
        }
    });
}
