import {
    createIdCounter
} from "./behaviour.js";
import {
    createDeleteButton,
    createDragHandle
} from "./elementsUtils.js";
import {
    getDataPathParent
} from "./utils.js"

export class ItemGrid {
    constructor(gridEl, cssClassNames, FieldClass, setupFns = [], { sortableChildrenSelectors = "" } = {}) {
        this.container = gridEl;
        this.cssClasses = cssClassNames.replace(/\./g, "");
        this.selector = cssClassNames.replace(/\s+/g, "");
        this.FieldClass = FieldClass;
        this.sortableChildrenSelectors = sortableChildrenSelectors;

        this._initFields();

        this._addMissingHtml();
        this.nextId = createIdCounter(this.container, `${this.selector}[data-id]`);

        for (const fn of setupFns) {
            fn(this);
        }
    }

    _addMissingHtml() {
        const container = this.container;
        // Find all layout-columns not already inside a layout-column-wrapper
        const columns = Array.from(container.querySelectorAll('.layout-column'))
            .filter(col => !col.closest('.layout-column-wrapper'));

        columns.forEach(col => {
            const addSlot = document.createElement('div');
            addSlot.className = 'add-slot';

            col.appendChild(addSlot);
        });
    }

    _initFields() {
        this.container
            .querySelectorAll(this.selector)
            .forEach(el => new this.FieldClass(el, ""));
    }

    _createNewItem({ column, forcedId, init }) {
        const id = forcedId || `${this.container.id}-${this.nextId()}`;
        const div = document.createElement('div');
        div.className = this.cssClasses;
        div.dataset.id = id;
        column.appendChild(div);

        const newItem = new this.FieldClass(div, init);
        this._recomputePositions();
        const position = this.positions[id];

        if (!forcedId) {
            const parentPath = getDataPathParent(div);
            div.dispatchEvent(new CustomEvent('createItemLocal', {
                bubbles: true,
                detail: { itemId: id, path: parentPath, init: newItem.init, itemPos: position }
            }));
        }
    }

    /** Pure read: return a fresh { id → {colIndex,rowIndex} } map */
    _snapshotPositions() {
        const snap = {};
        Array.from(this.container.querySelectorAll('.layout-column'))
            .forEach((col, cIdx) => {
                Array.from(col.children)
                    .filter(ch => ch.matches(this.selector))
                    .forEach((item, rIdx) => {
                        snap[item.dataset.id] = { colIndex: cIdx, rowIndex: rIdx };
                    });
            });
        return snap;
    }

    /** Overwrite this.positions (but keep oldPositions for diff) */
    _recomputePositions() {
        this.oldPositions = this.positions || {};
        this.positions = this._snapshotPositions();
    }

    _onSortEnd(evt) {
        this._recomputePositions();
        const prev = this.oldPositions || {};
        const curr = this.positions;
        const changed = Object.keys(curr).some(id =>
            prev[id]?.colIndex !== curr[id].colIndex ||
            prev[id]?.rowIndex !== curr[id].rowIndex
        );

        if (changed) {
            this.container.dispatchEvent(new CustomEvent('positionsChanged', {
                bubbles: true,
                detail: { positions: { ...curr } }
            }));
        }
    }
}

export class Tabs {
    /**
     * @param {HTMLElement} container - A `.tabs` element
     * @param {string} groupName - The radio button group name
     * @param {Array} setupFns - Setup functions to run
     * @param {Object} options
     * @param {string} options.addBtnText - Text for add-tab button
     * @param {string} options.tabContent - HTML for tab panel content
     * @param {string} options.tabLabel - HTML for tab label
     * @param {Function} options.createNestedGrid - Optional function to create ItemGrid in new panel
     */
    constructor(container, groupName, setupFns = [], {
        addBtnText = '+',
        tabContent = '',
        tabLabel = '',
        createNestedGrid = null
    } = {}) {
        this.container = container;
        this.groupName = groupName;
        this.tabContent = tabContent;
        this.tabLabel = tabLabel;
        this.createNestedGrid = createNestedGrid;

        // Store nested ItemGrid instances: tabId -> ItemGrid
        this.nestedGrids = new Map();

        this.nextId = createIdCounter(container, ".panel");

        this.addBtn = this.container.querySelector('.add-tab-btn')
            || this._createAddButton(addBtnText);
        this.addBtn.addEventListener('click', () => this._createNewItem());

        this.container.addEventListener('click', (e) => this._onRootClick(e));

        // Initialize existing nested grids
        this._initExistingGrids();

        Sortable.create(container, {
            draggable: '.tablabel',
            handle: '.drag-handle',
            animation: 150,

            onEnd: (evt) => {
                const movedLabel = evt.item;
                const id = movedLabel.getAttribute('for');
                const input = container.querySelector(`#${id}`);
                const panel = container.querySelector(`.panel[data-id="${id}"]`);

                // 1) Grab the *new* sequence of ALL labels
                const labels = Array.from(container.querySelectorAll('.tablabel'));
                const idx = labels.indexOf(movedLabel);

                let refNode;
                if (idx === 0) {
                    // If it’s now first, insert at very front (before the current first input)
                    // that is, before the first label’s input
                    const firstId = labels[1]?.getAttribute('for');
                    refNode = firstId
                        ? container.querySelector(`#${firstId}`) // the <input> of what is now 2nd tab
                        : container.querySelector('.add-tab-btn'); // fallback if it’s the only tab
                } else {
                    // Otherwise, find the previous label’s panel, and insert *after* it
                    const prevId = labels[idx - 1].getAttribute('for');
                    const prevPanel = container.querySelector(`.panel[data-id="${prevId}"]`);
                    refNode = prevPanel.nextSibling;
                }

                // 2) Detach & re-insert *just* this triplet in order:
                container.insertBefore(input, refNode);
                container.insertBefore(movedLabel, refNode);
                container.insertBefore(panel, refNode);

                this._recomputePositions();
                this._emitPositionsChanged();
            }
        });

        this.positions = {};

        for (const fn of setupFns) {
            fn(this);
        }
    }

    _initExistingGrids() {
        // Find all existing panels and initialize their grids
        const panels = this.container.querySelectorAll('.panel[data-id]');
        panels.forEach(panel => {
            const tabId = panel.dataset.id;
            const gridEl = panel.querySelector('[data-id$=".items"].item-grid');
            if (gridEl && this.createNestedGrid) {
                const grid = this.createNestedGrid(gridEl);
                this.nestedGrids.set(tabId, grid);
            }
        });
    }

    _createAddButton(text) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'add-tab-btn';
        btn.textContent = text;
        this.container.appendChild(btn);
        return btn;
    }

    /**
     * Counts current tabs by number of .radiotab inputs.
     * @returns {number}
     */
    _countTabs() {
        return this.container.querySelectorAll('.radiotab').length;
    }

    _onRootClick(e) {
        const btn = e.target.closest('button.delete-button');
        if (btn) {
            this.deleteTab(btn.closest('label').htmlFor);
        }
    }

    deleteTab(id, { local = true } = {}) {
        const radio = this.container.querySelector(`input.radiotab#${id}`);
        if (radio) radio.remove();

        const label = this.container.querySelector(`label[for="${id}"]`);
        if (label) label.remove();

        // find and remove delete button
        const delBtn = this.container.querySelector(`button.delete-tab[data-id="${id}"]`);
        if (delBtn) delBtn.remove();

        // find and remove panel
        const panel = this.container.querySelector(`.panel[data-id="${id}"]`);
        const parentPath = getDataPathParent(panel);

        // Clean up nested grid if exists
        if (this.nestedGrids.has(id)) {
            this.nestedGrids.delete(id);
        }

        if (panel) panel.remove();

        // if the deleted tab was checked, check the last one
        if (radio && radio.checked) {
            const radios = this.container.querySelectorAll('.radiotab');
            if (radios.length) {
                const last = radios[radios.length - 1];
                last.checked = true;
            }
        }

        if (local) {
            this.container.dispatchEvent(new CustomEvent('deleteItemLocal', {
                bubbles: true,
                detail: { itemId: id, path: parentPath }
            }));
        }
    }

    clearTabs({ local = true } = {}) {
        this.container.querySelectorAll('.radiotab, .tablabel')
            .forEach(el => el.remove());
        this.container.querySelectorAll('.panel')
            .forEach(panel => {
                const parentPath = getDataPathParent(panel);
                const id = panel.dataset.id;

                // Clean up nested grid
                if (this.nestedGrids.has(id)) {
                    this.nestedGrids.delete(id);
                }

                panel.remove();

                if (local) {
                    this.container.dispatchEvent(new CustomEvent('deleteItemLocal', {
                        bubbles: true,
                        detail: { itemId: id, path: parentPath }
                    }));
                }
            });
    }

    /**
     * Creates & appends a new tab (radio + label + panel),
     * and checks the new radio so its panel shows immediately.
     * @param {string} forcedId - passed forced id from remote event 
     * @param {bool} manual - was tab created manually or from pasting
     */
    _createNewItem({ forcedId = null, init = null } = {}) {
        const id = forcedId || `tab-${this.nextId()}`;

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = this.groupName;
        radio.id = id;
        radio.className = 'radiotab';

        if (!forcedId) {
            const prev = this.container.querySelector(`.radiotab:checked`);
            if (prev) prev.checked = false;
            radio.checked = true;
        }

        const label = document.createElement('label');
        label.className = 'tablabel';
        label.htmlFor = id;
        label.dataset.id = id;
        label.innerHTML = this.tabLabel;

        const handle = createDragHandle();
        const delBtn = createDeleteButton();

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.dataset.id = id;
        panel.innerHTML = this.tabContent;

        this.container.insertBefore(radio, this.addBtn);
        this.container.insertBefore(label, this.addBtn);
        label.appendChild(handle);
        label.appendChild(delBtn);
        this.container.insertBefore(panel, this.addBtn);

        // Create nested ItemGrid if factory provided
        if (this.createNestedGrid) {
            const gridEl = panel.querySelector('[data-id$=".items"].item-grid');
            if (gridEl) {
                const grid = this.createNestedGrid(gridEl);
                this.nestedGrids.set(id, grid);
            }
        }

        const parentPath = getDataPathParent(panel);

        if (!forcedId) {
            this._recomputePositions();
            const position = this.positions[id];

            this.container.dispatchEvent(new CustomEvent('createItemLocal', {
                bubbles: true,
                detail: {
                    itemId: id,
                    path: parentPath,
                    itemPos: position
                }
            }));
        }

        return { id, radio, label, panel };
    }
    selectTab(n = 0) {
        const radios = Array.from(this.container.querySelectorAll('.radiotab'));
        if (radios[n]) radios[n].checked = true;
    }

    _snapshotPositions() {
        const map = {};
        Array.from(this.container.querySelectorAll('.tablabel'))
            .forEach((label, idx) => {
                map[label.htmlFor] = {
                    colIndex: 0,
                    rowIndex: idx
                };
            });
        return map;
    }

    _recomputePositions() {
        this.oldPositions = this.positions || {};
        this.positions = this._snapshotPositions();
    }

    _emitPositionsChanged() {
        const prev = this.oldPositions || {};
        const curr = this.positions;

        const changed = Object.keys(curr).some(id => {
            const p = prev[id];
            const c = curr[id];
            return !p || p.colIndex !== c.colIndex || p.rowIndex !== c.rowIndex;
        });

        if (changed) {
            this.container.dispatchEvent(new CustomEvent('positionsChanged', {
                bubbles: true,
                detail: { positions: { ...curr } }
            }));
        }
    }
}

/**
 * Creates a reusable dropdown that can be toggled and closes on outside clicks
 * @param {Object} options
 * @param {Element} options.container - Parent element containing toggle and dropdown
 * @param {string} options.toggleSelector - Selector for toggle button
 * @param {string} options.dropdownSelector - Selector for dropdown content
 * @param {Function} options.onOpen - Optional callback when dropdown opens
 * @param {Function} options.onClose - Optional callback when dropdown closes
 * @param {Function} options.shouldCloseOnOutsideClick - Optional function(event) => boolean
 *                   Called only for clicks outside the dropdown. Return true to close, false to stay open.
 *                   If not provided, closes when clicking outside container.
 */
export class Dropdown {
    constructor({
        container,
        toggleSelector,
        dropdownSelector,
        onOpen,
        onClose,
        shouldCloseOnOutsideClick = null
    }) {
        this.container = container;
        this.toggleBtn = container.querySelector(toggleSelector);
        this.dropdown = container.querySelector(dropdownSelector);
        this.onOpen = onOpen;
        this.onClose = onClose;
        this.shouldCloseOnOutsideClick = shouldCloseOnOutsideClick;
        this.isOpen = false;
        this.root = container.getRootNode();

        if (!this.toggleBtn || !this.dropdown) {
            throw new Error(`Dropdown: missing elements (${toggleSelector} or ${dropdownSelector})`);
        }

        this._setupEventHandlers();
    }

    _setupEventHandlers() {
        // Toggle button click
        this.toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Stop propagation on dropdown clicks to prevent closing
        this.dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Click outside to close
        this._clickHandler = (e) => {
            // Don't close if clicking the toggle button (toggle() handles it)
            if (this.toggleBtn.contains(e.target)) {
                return;
            }

            // Don't close if clicking inside the dropdown
            if (this.dropdown.contains(e.target)) {
                return;
            }

            // Use custom logic if provided
            if (this.shouldCloseOnOutsideClick) {
                if (this.shouldCloseOnOutsideClick(e)) {
                    this.close();
                }
                return;
            }

            // Default: close if clicking outside the container
            if (!this.container.contains(e.target)) {
                this.close();
            }
        };

        this.root.addEventListener('click', this._clickHandler);
    }

    open() {
        if (this.isOpen) return;

        this.dropdown.classList.add('visible');
        this.toggleBtn.classList.add('active');
        this.isOpen = true;

        if (this.onOpen) {
            this.onOpen();
        }
    }

    close() {
        if (!this.isOpen) return;

        this.dropdown.classList.remove('visible');
        this.toggleBtn.classList.remove('active');
        this.isOpen = false;

        if (this.onClose) {
            this.onClose();
        }
    }

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    destroy() {
        this.root.removeEventListener('click', this._clickHandler);
    }
}