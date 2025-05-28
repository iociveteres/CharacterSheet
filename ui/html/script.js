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
    InventoryItemField,
    ExperienceField,
    PsychicPower
} from "./elements.js";

class ItemGrid {
    constructor(gridEl, cssClassNames, FieldClass, setupFns = [], { sortableChildrenSelectors = "" } = {}) {
        this.grid = gridEl;
        this.cssClasses = cssClassNames.replace(/\./g, "");
        this.selector = cssClassNames.replace(/\s+/g, "");
        this.FieldClass = FieldClass
        this.sortableChildrenSelectors = sortableChildrenSelectors

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
            .querySelectorAll(this.selector)
            .forEach(el => new this.FieldClass(el, ""));
    }

    _createNewItem(column) {
        const id = `${this.grid.id}-${this.nextId()}`;
        const div = document.createElement("div");
        div.className = this.cssClasses;
        div.dataset.id = id;
        column.appendChild(div);
        new this.FieldClass(div, "");
    }
}

function initExperienceTracker() {
    const totalXP = document.getElementById('experience-total');
    const spentXP = document.getElementById('experience-spent');
    const remainingXP = document.getElementById('experience-remaining');
    const xpContainer = document.getElementById('experience');

    function updateSpentXP() {
        let sum = 0;
        xpContainer.querySelectorAll('input.short').forEach(input => {
            const v = parseInt(input.value, 10);
            if (!isNaN(v)) sum += v;
        });
        spentXP.value = sum;
    }

    function updateRemainingXP() {
        const t = parseInt(totalXP.value, 10) || 0;
        const s = parseInt(spentXP.value, 10) || 0;
        remainingXP.value = t - s;
    }

    xpContainer.addEventListener('input', e => {
        if (e.target.matches('input.short')) {
            updateSpentXP();
            updateRemainingXP();
        }
    });

    xpContainer.addEventListener('click', e => {
        if (e.target.matches('button.delete-button')) {
            window.requestAnimationFrame(() => {
                updateSpentXP();
                updateRemainingXP();
            });
        }
    });

    totalXP.addEventListener('input', updateRemainingXP);

    // Run once to seed the fields
    updateSpentXP();
    updateRemainingXP();
}

document.addEventListener('DOMContentLoaded', () => {
    makeDeletable(document.querySelector(".container"))
    // attacks
    const attackGrid = [
        setupColumnAddButtons,
        makeSortable
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
        { sortableChildrenSelectors: ".tablabel .drag-handle" }
    );

    // talents and traits
    const talentsGrid = [
        setupColumnAddButtons,
        makeSortable
    ]

    new ItemGrid(
        document.querySelector("#talents"),
        ".item-with-description",
        SplitTextField,
        talentsGrid
    );

    new ItemGrid(
        document.querySelector("#traits"),
        ".item-with-description",
        SplitTextField,
        talentsGrid
    );

    //gear
    new ItemGrid(
        document.querySelector("#gear"),
        ".gear-item",
        InventoryItemField,
        talentsGrid
    );

    new ItemGrid(
        document.querySelector("#cybernetics"),
        ".item-with-description",
        SplitTextField,
        talentsGrid
    );

    // advancements
    new ItemGrid(
        document.querySelector("#experience"),
        ".experience-item",
        ExperienceField,
        talentsGrid
    )

    new ItemGrid(
        document.querySelector("#mutations"),
        ".item-with-description",
        SplitTextField,
        talentsGrid
    )

    new ItemGrid(
        document.querySelector("#mental-disorders"),
        ".item-with-description",
        SplitTextField,
        talentsGrid
    )

    new ItemGrid(
        document.querySelector("#diseases"),
        ".item-with-description",
        SplitTextField,
        talentsGrid
    )

    new ItemGrid(
        document.querySelector("#psychic-powers"),
        ".psychic-power .item-with-description",
        PsychicPower,
        talentsGrid
    )

    initExperienceTracker()
});

