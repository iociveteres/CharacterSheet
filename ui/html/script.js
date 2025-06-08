import {
    makeDeletable,
    createIdCounter,
    setupToggleAll,
    setupColumnAddButtons,
    setupGlobalAddButton,
    makeSortable
} from "./behaviour.js"

import {
    CustomSkill,
    SplitTextField,
    RangedAttack,
    MeleeAttack,
    InventoryItemField,
    ExperienceField,
    PsychicPower
} from "./elements.js";

import {
    calculateSkillAdvancement,
    calculateTestDifficulty,
    calculateCharacteristicBase,
    calculateDamageAbsorption
} from "./system.js"

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
    const xpContainer = document.getElementById('experience-log');

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


function initArmourTotals() {
    const natural = document.querySelector('input[data-id="natural_-rmour_value"]');
    const machine = document.querySelector('input[data-id="machine-value"]');
    const daemonic = document.querySelector('input[data-id="demonic-value"]');
    const other = document.querySelector('input[data-id="other-armour-value"]');
    const toughness = document.getElementById("T");
    const toughnessUnnatural = document.getElementById("T-unnatural");

    const toughnessBase = document.querySelector('input[data-id="toughness-base-absorption-value"]');

    const bodyParts = [
        'head',
        'left-arm',
        'right-arm',
        'body',
        'left-leg',
        'right-leg'
    ];

    function getBaseValue(part) {
        const input = document.getElementById(`armour-${part}`);
        return parseInt(input?.value, 10) || 0;
    }

    function updateTotals() {
        const naturalArmourVal = parseInt(natural?.value, 10) || 0;
        const machineVal = parseInt(machine?.value, 10) || 0;
        const daemonicVal = parseInt(daemonic?.value, 10) || 0;
        const otherArmourVal = parseInt(other?.value, 10) || 0;
        const toughnessVal = parseInt(toughness?.value, 10) || 0;
        const toughnessUnnaturalVal = parseInt(toughnessUnnatural?.value, 10) || 0;

        const toughnessBaseVal = calculateCharacteristicBase(toughnessVal, toughnessUnnaturalVal)

        bodyParts.forEach(part => {
            const armourValue = getBaseValue(part);
            const total = calculateDamageAbsorption(
                toughnessBaseVal,
                armourValue,
                naturalArmourVal,
                daemonicVal,
                machineVal,
                otherArmourVal
            );
            const totalField = document.getElementById(`armour-${part}-total`);
            if (totalField)
                totalField.value = total;
        });
    }

    function updateToughnessBase() {
        const t = parseInt(toughness?.value, 10) || 0;
        const tu = parseInt(toughnessUnnatural?.value, 10) || 0;
        const base = calculateCharacteristicBase(t, tu);
        if (toughnessBase)
            toughnessBase.value = base;
    }

    document.getElementById("armour").querySelectorAll('input').forEach(input => {
        input.addEventListener('input', updateTotals);
    });
    [toughness, toughnessUnnatural].forEach(input => {
        input?.addEventListener('input', updateTotals);
        input?.addEventListener('input', updateToughnessBase);
    });

    updateTotals();
    updateToughnessBase();
}


function initSkillsTable() {
    // 1) Cache references to all characteristic inputs by their ID
    const characteristics = {
        WS: document.getElementById('WS'),
        BS: document.getElementById('BS'),
        S: document.getElementById('S'),
        T: document.getElementById('T'),
        A: document.getElementById('A'),
        I: document.getElementById('I'),
        P: document.getElementById('P'),
        W: document.getElementById('W'),
        F: document.getElementById('F'),
        Inf: document.getElementById('Inf'),
        Cor: document.getElementById('Cor'),
    };

    // 2) Build a list of all skill‐rows. We assume each <tr> that has a test‐input qualifies.
    //    We look for any <input> whose data-id ends in "_test" and traverse up to its <tr>.
    const skillRows = Array.from(
        document.querySelectorAll('input[data-id$="_test"]')
    ).map(input => {
        const tr = input.closest('tr');
        return {
            row: tr,
            testInput: input,
            // We’ll look inside this row to find the select and checkboxes
        };
    });

    // 3) A helper to compute the total of checked advancement boxes in a given row.
    function computeAdvanceCount(tr) {
        const checkboxes = tr.querySelectorAll('input[type="checkbox"]');
        let sum = 0;
        checkboxes.forEach(cb => {
            if (cb.checked) {
                sum += 1;
            }
        });
        return sum;
    }

    // 4) A function that, for one skill‐row, recomputes and sets the test field.
    function updateOneSkill(rowObj) {
        const { row, testInput } = rowObj;
        const typeSelect = row.querySelector('select');
        if (!typeSelect) return;
        const characteristicKey = typeSelect.value;
        const charInput = characteristics[characteristicKey];
        if (!charInput) {
            testInput.value = '';
            return;
        }

        const characteristicValue = parseInt(charInput.value, 10) || 0;

        const advanceCount = computeAdvanceCount(row);
        const advanceValue = calculateSkillAdvancement(advanceCount)

        testInput.value = calculateTestDifficulty(characteristicValue, advanceValue);
    }

    // 5) A function that updates ALL skill‐rows at once
    function updateAllSkills() {
        skillRows.forEach(updateOneSkill);
    }

    // 6) Attach event listeners so that whenever a characteristic changes,
    //    or any checkbox/select in a skill‐row changes, we recalc.
    //    a) Characteristics: listen to 'input' or 'change' on each characteristic box.
    Object.values(characteristics).forEach(charInput => {
        charInput.addEventListener('input', () => {
            updateAllSkills();
        });
        charInput.addEventListener('change', () => {
            updateAllSkills();
        });
    });

    //    b) For each skill‐row, listen to changes on:
    //       - the <select> (type switch)
    //       - any of its checkboxes
    skillRows.forEach(({ row }) => {
        // (i) when the skill's type <select> changes → recalc
        const selectEl = row.querySelector('select');
        if (selectEl) {
            selectEl.addEventListener('change', () => {
                updateOneSkill({ row, testInput: row.querySelector('input[data-id$="_test"]') });
            });
        }

        // (ii) when any checkbox inside that row toggles → recalc
        const cbs = row.querySelectorAll('input[type="checkbox"]');
        cbs.forEach(cb => {
            cb.addEventListener('change', () => {
                updateOneSkill({ row, testInput: row.querySelector('input[data-id$="_test"]') });
            });
        });
    });

    // 7) Run one initial pass so that fields are populated on page load.
    updateAllSkills();

    // 8) check/uncheck skill upgrades
    document.querySelectorAll('tr:has(input[type="checkbox"])').forEach((row) => {
        const checkboxes = Array.from(row.querySelectorAll('input[type="checkbox"]'));

        checkboxes.forEach((checkbox, index) => {
            checkbox.addEventListener('change', () => {
                // 1) Toggle the checked state programmatically
                if (checkbox.checked) {
                    // Check all previous checkboxes, including the current one
                    for (let i = 0; i <= index; i++) {
                        checkboxes[i].checked = true;
                    }
                } else {
                    // Uncheck all subsequent checkboxes, including the current one
                    for (let i = index; i < checkboxes.length; i++) {
                        checkboxes[i].checked = false;
                    }
                }

                // 2) Build a payload of all fields in this row
                const changes = checkboxes.map(cb => {
                    const leaf = cb.dataset.id
                    return { path: leaf, value: cb.checked };
                });

                // 3) Dispatch a single "fields-updated" event for the whole row
                row.dispatchEvent(new CustomEvent("fields-updated", {
                    bubbles: true,
                    detail: { changes }
                }));
            });
        });
    });
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

function initPsykanaTracker() {
    const prBar = document.getElementById('pr-bar');
    const basePR = prBar.querySelector('input[data-id="base-pr"]');
    const sustainedPowers = prBar.querySelector('input[data-id="sustained-powers"]');
    const effectivePR = prBar.querySelector('input[data-id="effective-pr"]');

    function updateEffectivePR() {
        const basePRVal = parseInt(basePR.value, 10) || 0;
        const sustainedPowersCount = parseInt(sustainedPowers.value, 10) || 0;
        effectivePR.value = basePRVal - sustainedPowersCount;
    }

    basePR.addEventListener('input', e => {
        updateEffectivePR();
    });

    sustainedPowers.addEventListener('input', e => {
        updateEffectivePR();
    });

    updateEffectivePR();
}


document.addEventListener('DOMContentLoaded', () => {
    makeDeletable(document.querySelector(".container"))
    // attacks
    const attackGrid = [
        setupColumnAddButtons,
        makeSortable
    ]

    new ItemGrid(
        document.querySelector("#custom-skills"),
        ".custom-skill",
        CustomSkill,
        attackGrid
    );

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
        document.querySelector("#notes"),
        ".item-with-description",
        SplitTextField,
        talentsGrid
    );

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
        document.querySelector("#experience-log"),
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

    initArmourTotals();
    initSkillsTable();
    initWeightTracker();
    initExperienceTracker();
    initPsykanaTracker();
});

