import {
    createIdCounter
} from "./behaviour.js";
import {
    createDeleteButton,
    createDragHandle
} from "./elementsUtils.js";


export class ItemGrid {
    constructor(gridEl, cssClassNames, FieldClass, setupFns = [], { sortableChildrenSelectors = "" } = {}) {
        this.grid = gridEl;
        this.cssClasses = cssClassNames.replace(/\./g, "");
        this.selector = cssClassNames.replace(/\s+/g, "");
        this.FieldClass = FieldClass;
        this.sortableChildrenSelectors = sortableChildrenSelectors;

        this._initFields();

        this._addMissingHtml();
        this.nextId = createIdCounter(this.grid, `${this.selector}[data-id]`);

        for (const fn of setupFns) {
            fn(this);
        }
    }

    _addMissingHtml() {
        const container = this.grid;
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
        this.grid
            .querySelectorAll(this.selector)
            .forEach(el => new this.FieldClass(el, ""));
    }

    _createNewItem(column, forcedId) {
        // TO DO: check column to add item from server
        const id = forcedId || `${this.grid.id}-${this.nextId()}`;
        const div = document.createElement('div');
        div.className = this.cssClasses;
        div.dataset.id = id;
        column.appendChild(div);

        new this.FieldClass(div, "");

        if (!forcedId) {
            div.dispatchEvent(new CustomEvent('local-create-item', {
                bubbles: true,
                detail: { itemId: id }
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
    constructor(container, groupName, { addBtnText = '+', tabContent = '', tabLabel = '' } = {}) {
        this.root = container;
        this.groupName = groupName;
        this.tabContent = tabContent;
        this.tabLabel = tabLabel;

        this.nextId = createIdCounter(container, ".panel");

        this.addBtn = this.root.querySelector('.add-tab-btn')
            || this._createAddButton(addBtnText);
        this.addBtn.addEventListener('click', () => this.addTab());

        this.root.addEventListener('click', (e) => this._onRootClick(e));

        Sortable.create(container, {
            // only labels are draggable
            draggable: '.tablabel',
            handle: '.drag-handle',
            animation: 150,

            onEnd(evt) {
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
            }
        });
    }

    _createAddButton(text) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'add-tab-btn';
        btn.textContent = text;
        this.root.appendChild(btn);
        return btn;
    }

    /**
     * Counts current tabs by number of .radiotab inputs.
     * @returns {number}
     */
    _countTabs() {
        return this.root.querySelectorAll('.radiotab').length;
    }

    _onRootClick(e) {
        const btn = e.target.closest('button.delete-button');
        if (btn) {
            this.deleteTab(btn.closest('label').htmlFor);
        }
    }

    deleteTab(id) {
        // find and remove radio input
        const radio = this.root.querySelector(`input.radiotab#${id}`);
        if (radio) radio.remove();

        // find and remove label
        const label = this.root.querySelector(`label[for="${id}"]`);
        if (label) label.remove();

        // find and remove delete button
        const delBtn = this.root.querySelector(`button.delete-tab[data-id="${id}"]`);
        if (delBtn) delBtn.remove();

        // find and remove panel
        const panel = this.root.querySelector(`.panel[data-id="${id}"]`);
        if (panel) panel.remove();

        // if the deleted tab was checked, check the last one
        if (radio && radio.checked) {
            const radios = this.root.querySelectorAll('.radiotab');
            if (radios.length) {
                const last = radios[radios.length - 1];
                last.checked = true;
            }
        }
    }

    clearTabs() {
        this.root.querySelectorAll('.radiotab, .tablabel, .panel')
            .forEach(el => el.remove());
    }
    /**
     * Creates & appends a new tab (radio + label + panel),
     * and checks the new radio so its panel shows immediately.
     */
    addTab(forcedId) {
        const idx = forcedId || this.nextId();
        const id = `${this.groupName}__tab-${idx}`;

        // 1) new radio
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = this.groupName;
        radio.id = id;
        radio.className = 'radiotab';

        // uncheck existing, check the new one
        const prev = this.root.querySelector(`.radiotab:checked`);
        if (prev) prev.checked = false;
        radio.checked = true;

        // 2) new label
        const label = document.createElement('label');
        label.className = 'tablabel';
        label.htmlFor = id;
        label.innerHTML = this.tabLabel;

        const handle = createDragHandle();
        const delBtn = createDeleteButton();

        // 3) new panel
        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.dataset.id = id;
        panel.innerHTML = this.tabContent;

        // 4) insert before the add-tab button
        this.root.insertBefore(radio, this.addBtn);
        this.root.insertBefore(label, this.addBtn);
        label.appendChild(handle);
        label.appendChild(delBtn);
        this.root.insertBefore(panel, this.addBtn);

        if (!forcedId) {
            this.root.dispatchEvent(new CustomEvent('local-create-item', {
                bubbles: true,
                detail: { itemId: id }
            }));
        }

        return { id, radio, label, panel };
    }

    /**
     * Programmatically select the nth tab (0-based).
     */
    selectTab(n = 0) {
        const radios = Array.from(this.root.querySelectorAll('.radiotab'));
        if (radios[n]) radios[n].checked = true;
    }
}

