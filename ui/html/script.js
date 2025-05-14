import {
    makeDeletable,
    createIdCounter,
    setupToggleAll,
    setupColumnAddButtons,
    setupGlobalAddButton,
    makeSortable
} from "./behaviour.js"

import { 
    SplitTextField,
    RangedAttack,
    MeleeAttack,
    ExperienceField
 } from "./elements.js";

class ItemGrid {
    constructor(gridEl, cssClassName, FieldClass, setupFns = [], {sortableChildrenSelectors = ""} = {}) {
        this.grid = gridEl;
        this.cssClassName = cssClassName;
        this.FieldClass = FieldClass
        this.sortableChildrenSelectors = sortableChildrenSelectors

        this._initFields();

        this._addMissingHtml();
        this.nextId = createIdCounter(this.grid, `${this.cssClassName}[data-id]`);

        for (const fn of setupFns) {
            fn(this);
        }
    }

    _addMissingHtml() {
        const container = this.grid;
        if (!container.querySelector(':scope > .grid-controls')) {
            const gridControls = document.createElement('div');
            gridControls.className = 'grid-controls';
            container.insertBefore(gridControls, container.firstChild);
        }

        // Find all layout-columns not already inside a layout-column-wrapper
        const columns = Array.from(container.querySelectorAll('.layout-column'))
            .filter(col => !col.closest('.layout-column-wrapper'));

        columns.forEach(col => {
            const wrapper = document.createElement('div');
            wrapper.className = 'layout-column-wrapper';

            const addSlot = document.createElement('div');
            addSlot.className = 'add-slot';

            // Wrap column
            const parent = col.parentNode;
            parent.insertBefore(wrapper, col);
            wrapper.appendChild(col);

            // Append add-slot after the layout-column inside wrapper
            wrapper.appendChild(addSlot);
        });
    }

    _initFields() {
        this.grid
            .querySelectorAll(this.cssClassName)
            .forEach(el => new this.FieldClass(el, ""));
    }

    _createNewItem(column) {
        const id = `${this.grid.id}-${this.nextId()}`;
        const div = document.createElement("div");
        div.className = this.cssClassName.replace(/^\./, ""); // strip leading “.” if you prefer
        div.dataset.id = id;
        column.appendChild(div);
        new this.FieldClass(div, "");
    }
}

const talentsGrid = [
    setupToggleAll,
    setupColumnAddButtons,
    setupGlobalAddButton,
    makeSortable,
    makeDeletable
]

new ItemGrid(
    document.querySelector("#talents"),
    ".split-text-field",
    SplitTextField,
    talentsGrid
);

new ItemGrid(
    document.querySelector("#traits"),
    ".split-text-field",
    SplitTextField,
    talentsGrid
);

const attackGrid = [
    setupColumnAddButtons,
    setupGlobalAddButton,
    makeSortable,
    makeDeletable
]

new ItemGrid(
    document.querySelector("#ranged-attack"),
    ".ranged-attack",
    RangedAttack,
    attackGrid
);

new ItemGrid(
    document.querySelector("#melee-attack"),
    ".melee-attack",
    MeleeAttack,
    attackGrid,
    {sortableChildrenSelectors: ".tablabel .drag-handle"}
);

new ItemGrid(
    document.querySelector("#experience"),
    ".experience-item",
    ExperienceField,
    talentsGrid
)

new ItemGrid(
    document.querySelector("#mutations"),
    ".split-text-field",
    SplitTextField,
    talentsGrid
)

new ItemGrid(
    document.querySelector("#mental-disorders"),
    ".split-text-field",
    SplitTextField,
    talentsGrid
)

new ItemGrid(
    document.querySelector("#diseases"),
    ".split-text-field",
    SplitTextField,
    talentsGrid
)