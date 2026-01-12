import {
    getRoot,
    getLeafFromPath,
    findElementByPath,
    getDataPath,
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
        const currentPanel = getRoot().querySelector('.radiotab[name="toggle"]:checked+.tablabel+.panel');
  
        const allVisibleItems = currentPanel.querySelectorAll(".item-with-description");

        // Filter to only items that have content (non-empty description or other fields)
        const itemsWithContent = Array.from(allVisibleItems).filter(item => {
            const description = item.querySelector('.split-description');
            const hasDescription = description && description.value.trim() !== '';

            const collapsibleContent = item.querySelector('.collapsible-content');
            const hasOtherContent = collapsibleContent &&
                Array.from(collapsibleContent.querySelectorAll('input:not(.split-description), select, textarea:not(.split-description)'))
                    .some(field => {
                        if (field.type === 'checkbox') return field.checked;
                        return field.value && field.value.trim() !== '';
                    });

            return hasDescription || hasOtherContent;
        });

        const shouldExpand = itemsWithContent.some(item =>
            item.classList.contains('collapsed')
        );

        if (shouldExpand) {
            itemsWithContent.forEach(item => {
                item.classList.remove('collapsed');
            });
        } else {
            allVisibleItems.forEach(item => {
                item.classList.add('collapsed');
            });
        }
    });
}

export function setupHandleEnter() {
    getRoot().addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const target = e.target;

        // Handle textareas
        if (target.tagName === 'TEXTAREA') {
            if (target.classList.contains('split-description')) {
                e.preventDefault();
                const start = target.selectionStart;
                const end = target.selectionEnd;
                const value = target.value;
                target.value = value.substring(0, start) + '\n' + value.substring(end);
                target.selectionStart = target.selectionEnd = start + 1;
                target.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
        }

        // Handle inputs - cycle to next field
        if (target.tagName === 'INPUT' && !e.shiftKey) {
            // Find container - try multiple selectors
            const container = target.closest('.item-with-description, .custom-skill, .ranged-attack, .melee-attack, .experience-item, .psychic-power, .tech-power, .gear-item');
            if (!container) return;

            e.preventDefault();
            cycleToNextField(target, container);
        }
    });

    function cycleToNextField(currentField, container) {
        const allInputs = Array.from(
            container.querySelectorAll('input:not([readonly]):not([disabled]), textarea')
        );

        const currentIndex = allInputs.indexOf(currentField);
        const nextField = allInputs[currentIndex + 1];

        if (nextField) {
            nextField.focus();

            // If it's a textarea, show it
            if (nextField.classList.contains('split-description')) {
                nextField.classList.add('visible');
            }
        }
    }
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
        const item = e.target;

        // Handle new collapsible content style
        const hasCollapsible = item.querySelector('.collapsible-content');
        if (hasCollapsible) {
            if (e.detail.open) {
                item.classList.remove('collapsed');
            } else {
                item.classList.add('collapsed');
            }
        } else {
            // Legacy behavior for old-style items
            const descEl = item.querySelector('.split-description');
            if (!descEl) return;

            if (e.detail.open) {
                descEl.classList.add("visible");
            } else {
                descEl.classList.remove("visible");
            }
        }

        e.stopPropagation();
    });
}

/**
 * Enhanced makeSortable for cross-grid dragging with tab switching
 * @param {Object} itemGridInstance - ItemGrid or nested grid
 * @param {Object} options
 * @param {string} options.sharedGroup - Sortable group name for cross-grid dragging
 * @param {Function} options.onTabSwitch - Callback when dragging over a tab
 */
export function makeSortable(itemGridInstance, options = {}) {
    const { container, sortableChildrenSelectors } = itemGridInstance;
    const { sharedGroup = null, onTabSwitch = null } = options;
    const shadowRoot = container.getRootNode();
    const isInShadow = shadowRoot !== document;
    const cols = container.querySelectorAll(".layout-column");

    function elementFromPointDeep(x, y) {
        let element = document.elementFromPoint(x, y);
        while (element?.shadowRoot) {
            const innerElement = element.shadowRoot.elementFromPoint(x, y);
            if (!innerElement || innerElement === element) break;
            element = innerElement;
        }
        return element;
    }

    function findElementById(id, root = isInShadow ? shadowRoot : document) {
        const element = root.getElementById?.(id);
        if (element) return element;
        if (isInShadow) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node;
            while (node = walker.nextNode()) {
                if (node.shadowRoot) {
                    const found = findElementById(id, node.shadowRoot);
                    if (found) return found;
                }
            }
        }
        return null;
    }

    cols.forEach((col, colIdx) => {
        const sortableConfig = {
            animation: 150,
            handle: ".drag-handle",
            filter: sortableChildrenSelectors,
            ghostClass: "sortable-ghost",
            forceFallback: true,
            fallbackTolerance: 3,
        };

        if (sharedGroup) {
            sortableConfig.group = {
                name: sharedGroup,
                pull: true,
                put: true
            };
            let dragStartGrid = null;
            let dragStartTabId = null;
            let tabSwitchTimeout = null;
            let currentHoveredTab = null;
            let mouseMoveHandler = null;

            sortableConfig.onStart = (evt) => {
                if (evt.item) {
                    evt.item.classList.add('is-dragging');
                }
                dragStartGrid = evt.from.closest('[data-id$=".items"]');
                const startingTab = dragStartGrid?.closest('.panel');
                dragStartTabId = startingTab?.dataset?.id;

                mouseMoveHandler = (e) => {
                    const hoveredElement = elementFromPointDeep(e.clientX, e.clientY);
                    const hoveredTab = hoveredElement?.closest('.tablabel');

                    if (hoveredTab === currentHoveredTab) return;

                    if (currentHoveredTab) {
                        currentHoveredTab.classList.remove('drag-over');
                    }
                    if (tabSwitchTimeout) {
                        clearTimeout(tabSwitchTimeout);
                        tabSwitchTimeout = null;
                    }

                    currentHoveredTab = hoveredTab;

                    if (hoveredTab) {
                        hoveredTab.classList.add('drag-over');
                        const tabId = hoveredTab.getAttribute('for');
                        tabSwitchTimeout = setTimeout(() => {
                            const radio = findElementById(tabId);
                            if (radio && !radio.checked) {
                                radio.checked = true;
                                radio.dispatchEvent(new Event('change', {
                                    bubbles: true,
                                    composed: true
                                }));
                                if (onTabSwitch) {
                                    onTabSwitch(tabId);
                                }
                                if (currentHoveredTab) {
                                    requestAnimationFrame(() => {
                                        if (currentHoveredTab) {
                                            currentHoveredTab.classList.add('drag-over');
                                        }
                                    });
                                }
                            }
                            tabSwitchTimeout = null;
                        }, 500);
                    }
                };
                document.addEventListener('pointermove', mouseMoveHandler, { passive: true });
                document.addEventListener('mousemove', mouseMoveHandler, { passive: true });
            };

            sortableConfig.onEnd = (evt) => {
                if (mouseMoveHandler) {
                    document.removeEventListener('pointermove', mouseMoveHandler);
                    document.removeEventListener('mousemove', mouseMoveHandler);
                    mouseMoveHandler = null;
                }
                if (tabSwitchTimeout) {
                    clearTimeout(tabSwitchTimeout);
                    tabSwitchTimeout = null;
                }
                const rootToSearch = isInShadow ? shadowRoot : document;
                const allTabs = rootToSearch.querySelectorAll('.tablabel.drag-over');
                allTabs.forEach(tab => tab.classList.remove('drag-over'));

                const fromGrid = dragStartGrid;
                const toGrid = evt.to.closest('[data-id$=".items"]');

                if (fromGrid && toGrid && fromGrid !== toGrid) {
                    const item = evt.item;
                    const itemId = item.dataset.id;
                    const fromPath = getDataPath(fromGrid);
                    const toPath = getDataPath(toGrid);
                    const toColumn = evt.to;
                    const allColumns = toGrid.querySelectorAll('.layout-column');
                    const toColIndex = Array.from(allColumns).indexOf(toColumn);
                    const itemsInColumn = Array.from(toColumn.children)
                        .filter(ch => ch.matches(`.${item.classList[0]}`));
                    const toRowIndex = itemsInColumn.indexOf(item);

                    const destinationPanel = toGrid.closest('.panel');
                    if (destinationPanel) {
                        const destinationTabId = destinationPanel.dataset.id;
                        const destinationRadio = findElementById(destinationTabId);
                        if (destinationRadio) {
                            requestAnimationFrame(() => {
                                destinationRadio.checked = true;
                                destinationRadio.dispatchEvent(new Event('change', {
                                    bubbles: true,
                                    composed: true
                                }));
                            });
                        }
                    }

                    container.dispatchEvent(new CustomEvent('moveItemBetweenGridsLocal', {
                        bubbles: true,
                        composed: true,
                        detail: {
                            fromPath,
                            toPath,
                            itemId,
                            toPosition: {
                                colIndex: toColIndex,
                                rowIndex: toRowIndex
                            }
                        }
                    }));
                } else {
                    itemGridInstance._onSortEnd.call(itemGridInstance, evt);
                }
            };
        } else {
            sortableConfig.group = container.id;
            sortableConfig.onStart = (evt) => {
                if (evt.item) {
                    evt.item.classList.add('is-dragging');
                }
            };
            sortableConfig.onEnd = itemGridInstance._onSortEnd.bind(itemGridInstance);
        }

        const originalOnEnd = sortableConfig.onEnd;
        sortableConfig.onEnd = (evt) => {
            try {
                if (evt.item) {
                    evt.item.classList.remove('is-dragging');
                }
            } catch (e) {
                console.error('Error removing is-dragging class:', e);
            }
            originalOnEnd(evt);
        };
        new Sortable(col, sortableConfig);
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
        e.stopPropagation();

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
        e.stopPropagation();

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

export function initCreateItemHandler(instance) {
    const { container, _createNewItem } = instance;
    container.addEventListener('createItemRemote', e => {
        const { itemId, itemPos, init } = e.detail;

        const isTabs = typeof instance.deleteTab === 'function';

        if (isTabs) {
            _createNewItem.call(instance, {
                forcedId: itemId,
                manual: false,
                init
            });
        } else {
            let column = null;
            if (itemPos?.colIndex != null) {
                column = container.querySelector(`[data-column="${itemPos.colIndex}"]`);
            }
            _createNewItem.call(instance, { column, forcedId: itemId, init });
        }
    });
}


export function initDeleteItemHandler(instance) {
    const { container } = instance;
    container.addEventListener('deleteItemRemote', e => {
        const { path } = e.detail;
        const leaf = getLeafFromPath(path);

        const isTabs = typeof instance.deleteTab === 'function';

        if (isTabs) {
            instance.deleteTab(leaf, { local: false });
        } else {
            const element = container.querySelector(`[data-id="${leaf}"]`);
            if (element) {
                element.remove();
            }
        }
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


/**
 * Syncs local moveItemBetweenGrids events to the server
 */
export function initMoveItemBetweenGridsSender(container, { socket }) {
    container.addEventListener('moveItemBetweenGridsLocal', e => {
        e.stopPropagation();

        const { fromPath, toPath, itemId, toPosition } = e.detail || {};

        const msg = {
            type: 'moveItemBetweenGrids',
            eventID: crypto.randomUUID(),
            sheetID: document.getElementById('charactersheet')?.dataset.sheetId || null,
            fromPath,
            toPath,
            itemId,
            toPosition
        };

        socket.send(JSON.stringify(msg));
    });
}

/**
 * Handles remote moveItemBetweenGrids events
 */
export function initMoveItemBetweenGridsHandler(tabsInstance) {
    const { container } = tabsInstance;

    container.addEventListener('moveItemBetweenGridsRemote', e => {
        const { fromPath, toPath, itemId, toPosition } = e.detail;

        // Find source and destination grids
        const fromGrid = findElementByPath(fromPath);
        const toGrid = findElementByPath(toPath);

        if (!fromGrid || !toGrid) {
            console.error('Could not find grids for move:', fromPath, toPath);
            return;
        }

        // Find the item in source grid
        const item = fromGrid.querySelector(`[data-id="${itemId}"]`);
        if (!item) {
            console.error('Could not find item:', itemId);
            return;
        }

        // Remove from source
        item.remove();

        // Add to destination at correct position
        const destCols = toGrid.querySelectorAll('.layout-column');
        const destCol = destCols[toPosition.colIndex];
        if (!destCol) {
            console.error('Invalid destination column:', toPosition.colIndex);
            return;
        }

        // Insert at correct row position
        const existingItems = Array.from(destCol.children)
            .filter(ch => ch.classList.contains(item.classList[0]));

        if (toPosition.rowIndex >= existingItems.length) {
            destCol.appendChild(item);
        } else {
            destCol.insertBefore(item, existingItems[toPosition.rowIndex]);
        }
    });
}
