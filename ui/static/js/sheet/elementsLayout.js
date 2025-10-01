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

    _createNewItem(column, forcedId, init) {
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
     * @param {HTMLElement|string} container  A `.tabs` element
     * @param {Object} groupName The radio‐button group name
     * @param {Object} options
     * @param {string} options.addBtnText Text for the add-tab button
     * @param {string} options.tabContent HTML that tab contains
     */
    constructor(container, groupName, setupFns = [], { addBtnText = '+', tabContent = '', tabLabel = '' } = {}) {
        this.container = container;
        this.groupName = groupName;
        this.tabContent = tabContent;
        this.tabLabel = tabLabel;

        this.nextId = createIdCounter(container, ".panel");

        this.addBtn = this.container.querySelector('.add-tab-btn')
            || this._createAddButton(addBtnText);
        this.addBtn.addEventListener('click', () => this._createNewItem());

        this.container.addEventListener('click', (e) => this._onRootClick(e));

        Sortable.create(container, {
            // only labels are draggable
            draggable: '.tablabel',
            handle: '.drag-handle',
            animation: 150,

            onEnd: (evt) => {
                const movedLabel = evt.item; // the <label> you dragged
                const id = movedLabel.getAttribute('for'); // e.g. "melee-attack-1__tab-3"
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
                    refNode = prevPanel.nextSibling; // could be another input/label or the + button
                }

                // 2) Detach & re-insert *just* this triplet in order:
                container.insertBefore(input, refNode);
                container.insertBefore(movedLabel, refNode);
                container.insertBefore(panel, refNode);

                this._recomputePositions();
                this._emitPositionsChanged();
            }
        });

        // positions: map of tabId -> index
        this.positions = {};

        for (const fn of setupFns) {
            fn(this);
        }
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
        // find and remove radio input
        const radio = this.container.querySelector(`input.radiotab#${id}`);
        if (radio) radio.remove();

        // find and remove label
        const label = this.container.querySelector(`label[for="${id}"]`);
        if (label) label.remove();

        // find and remove delete button
        const delBtn = this.container.querySelector(`button.delete-tab[data-id="${id}"]`);
        if (delBtn) delBtn.remove();

        // find and remove panel
        const panel = this.container.querySelector(`.panel[data-id="${id}"]`);
        const parentPath = getDataPathParent(panel);
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

    clearTabs() {
        this.container.querySelectorAll('.radiotab, .tablabel, .panel')
            .forEach(el => el.remove());
    }
    /**
     * Creates & appends a new tab (radio + label + panel),
     * and checks the new radio so its panel shows immediately.
     * @param {string} forcedId - passed forced id from remote event 
     * @param {bool} manual - was tab created manually or from pasting,
     * hence should it fire event
     */
    _createNewItem({ forcedId = null, local = true } = {}) {
        const id = forcedId || `tab-${this.nextId()}`;

        // 1) new radio
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = this.groupName;
        radio.id = id;
        radio.className = 'radiotab';

        // uncheck existing, check the new one
        const prev = this.container.querySelector(`.radiotab:checked`);
        if (prev) prev.checked = false;
        radio.checked = true;

        // 2) new label
        const label = document.createElement('label');
        label.className = 'tablabel';
        label.htmlFor = id;
        label.dataset.id = id;
        label.innerHTML = this.tabLabel;

        const handle = createDragHandle();
        const delBtn = createDeleteButton();

        // 3) new panel
        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.dataset.id = id;
        panel.innerHTML = this.tabContent;

        // 4) insert before the add-tab button
        this.container.insertBefore(radio, this.addBtn);
        this.container.insertBefore(label, this.addBtn);
        label.appendChild(handle);
        label.appendChild(delBtn);
        this.container.insertBefore(panel, this.addBtn);

        const parentPath = getDataPathParent(panel);

        if (!forcedId && local) {
            this.container.dispatchEvent(new CustomEvent('createItemLocal', {
                bubbles: true,
                detail: { itemId: id, path: parentPath }
            }));
        }

        return { id, radio, label, panel };
    }

    /**
     * Programmatically select the nth tab (0-based).
     */
    selectTab(n = 0) {
        const radios = Array.from(this.container.querySelectorAll('.radiotab'));
        if (radios[n]) radios[n].checked = true;
    }

    /**
     * Return a fresh map of {tabId → index} without mutating state
     */
    _snapshotPositions() {
        const map = {};
        Array.from(this.container.querySelectorAll('.tablabel'))
            .forEach((label, idx) => {
                map[label.htmlFor] = idx;
            });
        return map;
    }

    /**
     * Recompute and overwrite this.positions from the DOM
     */
    _recomputePositions() {
        this.oldPositions = this.positions || {};
        this.positions = this._snapshotPositions();
    }

    /**
     * Dispatch a "positionsChanged" event with the current map
     */
    _emitPositionsChanged() {
        const prev = this.oldPositions || {};
        const curr = this.positions;
        const changed = Object.keys(curr).some(id => prev[id] !== curr[id]);
        if (changed) {
            this.container.dispatchEvent(new CustomEvent('positionsChanged', {
                bubbles: true,
                detail: { positions: { ...curr } }
            }));
        }
    }
}

