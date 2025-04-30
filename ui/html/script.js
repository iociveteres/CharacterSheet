import {
    makeDeletable,
    createIdCounter,
    setupToggleAll,
    setupColumnAddButtons,
    setupGlobalAddButton,
    makeSortable
} from "./behaviour.js"

import { SplitTextField } from "./splitTextField.js";

class ItemGrid {
    constructor(gridEl, cssClassName, FieldClass, setupFns = []) {
        this.grid = gridEl;
        this.cssClassName = cssClassName;
        this.FieldClass = FieldClass

        this._initFields();

        this.nextId = createIdCounter(this.grid, `${this.cssClassName}[data-id]`);
        makeDeletable(gridEl);

        for (const fn of setupFns) {
            fn(this);
        }
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
    makeSortable
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
