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
    const totalXP = document.querySelector('input[data-id="experience-total"]');
    const spentXP = document.querySelector('input[data-id="experience-spent"]');
    const remainingXP = document.querySelector('input[data-id="experience-remaining"]');
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

function initWeightTracker() {
    const carryWeightBase = document.querySelector('input[data-id="carry-weight-base"]');
    const carryWeight = document.querySelector('input[data-id="carry-weight"]');
    const liftWeight = document.querySelector('input[data-id="lift-weight"]');
    const pushWeight = document.querySelector('input[data-id="push-weight"]');
    const encumbrance = document.querySelector('input[data-id="encumbrance"]');
    const gearContainer = document.getElementById('gear');

    // Index = S.b + T.b
    const carryWeights = [
        0.9, 2.25, 4.5, 9, 18, 27, 36, 45, 56, 68,
        78, 90, 112, 125, 337, 450, 675, 900, 1350, 1800,
        2250, 2900, 3550, 4200, 4850, 5500, 6300, 7250, 8300, 9550,
        11000, 13000, 15000, 17000, 20000, 23000, 26000, 30000, 35000, 40000,
        46000, 53000, 70000, 80000, 92000, 106000
    ];

    const liftWeights = [
        2.25, 4.5, 9, 18, 36, 54, 72, 90, 112, 134,
        156, 180, 224, 450, 674, 900, 1350, 1800, 2700, 3600,
        4500, 5800, 7100, 8400, 9700, 11000, 12600, 14500, 16600, 19100,
        22000, 26000, 30000, 34000, 40000, 46000, 52000, 60000, 70000, 80000,
        92000, 106000, 140000, 160000, 184000, 212000
    ];

    const pushWeights = [
        4.5, 9, 18, 36, 72, 108, 144, 180, 224, 268,
        312, 360, 448, 900, 1348, 1800, 2700, 3600, 5400, 7200,
        9000, 11600, 14200, 16800, 19400, 22000, 25200, 29000, 33200, 38200,
        44000, 52000, 60000, 68000, 80000, 92000, 104000, 120000, 140000, 160000,
        184000, 212000, 280000, 320000, 368000, 424000
    ];

    function updateEncumbrance() {
        let sum = 0;
        gearContainer.querySelectorAll('input.short').forEach(input => {
            const v = parseFloat(input.value, 10);
            if (!isNaN(v)) sum += v;
        });
        encumbrance.value = sum;
    }

    function updateWeights() {
        if (carryWeightBase.value === "")
            return;
        const t = parseInt(carryWeightBase.value, 10) || 0;
        if (t > 45) {
            carryWeight.value = "too";
            liftWeight.value = "strong";
            pushWeight.value = "to hold!";
            return
        }
        if (t < 0) {
            carryWeight.value = "such";
            liftWeight.value = "a puny";
            pushWeight.value = "weakling!";
            return
        }
        carryWeight.value = carryWeights[t];
        liftWeight.value = liftWeights[t];
        pushWeight.value = pushWeights[t];
    }

    gearContainer.addEventListener('input', e => {
        if (e.target.matches('input.short')) {
            updateEncumbrance();
        }
    });

    carryWeightBase.addEventListener('input', updateWeights)

    gearContainer.addEventListener('click', e => {
        if (e.target.matches('button.delete-button')) {
            window.requestAnimationFrame(() => {
                updateEncumbrance();
            });
        }
    });

    // Run once to seed the fields
    updateEncumbrance();
    updateWeights();
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

    initWeightTracker();
    initExperienceTracker();
});

