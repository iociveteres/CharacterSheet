import {
    makeDeletable,
    setupToggleAll,
    setupColumnAddButtons,
    setupGlobalAddButton,
    makeSortable,
    initCreateItemSender,
    initCreateItemHandler,
    initDeleteItemHandler,
    initDeleteItemSender,
    initChangeHandler,
    initBatchHandler,
    initPositionsChangedHandler,
} from "./behaviour.js"

import {
    mockSocket,
    getRoot
} from "./utils.js"

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

import {
    ItemGrid
} from "./elementsLayout.js";

import {
    socket
} from "./network.js"

function initExperienceTracker(root) {
    const totalXP = root.querySelector('input[data-id="experience-total"]');
    const spentXP = root.querySelector('input[data-id="experience-spent"]');
    const remainingXP = root.querySelector('input[data-id="experience-remaining"]');
    const xpContainer = root.getElementById('experience-log');

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


function initArmourTotals(root) {
    const natural = root.querySelector('input[data-id="natural-armour-value"]');
    const machine = root.querySelector('input[data-id="machine-value"]');
    const daemonic = root.querySelector('input[data-id="demonic-value"]');
    const other = root.querySelector('input[data-id="other-armour-value"]');
    const toughness = root.getElementById("T");
    const toughnessUnnatural = root.getElementById("T-unnatural");

    const toughnessBase = root.querySelector('input[data-id="toughness-base-absorption-value"]');

    const bodyParts = [
        'head',
        'left-arm',
        'right-arm',
        'body',
        'left-leg',
        'right-leg'
    ];

    function getBaseValue(part) {
        const input = root.getElementById(`armour-${part}`);
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
            const totalField = root.getElementById(`armour-${part}-total`);
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

    root.getElementById("armour").querySelectorAll('input').forEach(input => {
        input.addEventListener('input', updateTotals);
    });
    [toughness, toughnessUnnatural].forEach(input => {
        input?.addEventListener('input', updateTotals);
        input?.addEventListener('input', updateToughnessBase);
    });

    updateTotals();
    updateToughnessBase();
}


function initSkillsTable(root) {
    const skillsBlock = root.getElementById('skills');
    // 1) Cache references to all characteristic inputs by their ID
    const characteristics = {
        WS: root.getElementById('WS'),
        BS: root.getElementById('BS'),
        S: root.getElementById('S'),
        T: root.getElementById('T'),
        A: root.getElementById('A'),
        I: root.getElementById('I'),
        P: root.getElementById('P'),
        W: root.getElementById('W'),
        F: root.getElementById('F'),
        Inf: root.getElementById('Inf'),
        Cor: root.getElementById('Cor'),
    };

    // 2) A helper to compute the total of checked advancement boxes in a given row.
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

    // 3) A function that, for one skill‐row, recomputes and sets the test field.
    function updateOneSkill(row) {
        const typeSelect = row.querySelector('select');
        if (!typeSelect) return;
        const testInput = row.querySelector('input[data-id="difficulty"]');
        if (!testInput) return;

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

    // 4) A function that updates ALL skill‐rows at once
    function updateAllSkills() {
        skillsBlock.querySelectorAll(
            'tr:has(input[data-id="difficulty"]), div.custom-skill'
        ).forEach(updateOneSkill);
    }

    // 5) Attach event listener to checkboxes and characteristic selects
    skillsBlock.addEventListener('change', (event) => {
        const target = event.target;
        const row = target.closest('tr, .custom-skill');
        if (!row) return;

        // --- CASE 1: characteristic selector changed
        if (target.matches('select[data-id="characteristic"]')) {
            updateOneSkill(row);
            return;
        }

        // --- CASE 2: one of the upgrade‐checkboxes toggled
        if (target.matches('input[type="checkbox"]')) {
            const checkboxes = Array.from(row.querySelectorAll('input[type="checkbox"]'));
            const idx = checkboxes.indexOf(target);

            // 1) Toggle the chain of checkboxes
            if (target.checked) {
                for (let i = 0; i <= idx; i++) checkboxes[i].checked = true;
            } else {
                for (let i = idx; i < checkboxes.length; i++) checkboxes[i].checked = false;
            }

            // 2) Send fields‐updated for your WebSocket plumbing
            const changes = Object.fromEntries(
                checkboxes.map(cb => [cb.dataset.id, cb.checked])
            );
            row.dispatchEvent(new CustomEvent('fieldsUpdated', {
                bubbles: true,
                detail: { changes }
            }));

            // 3) Recalc the display
            updateOneSkill(row);
        }
    });

    // 6) update skill difficuly when characteristic is changed
    const characteristicsContainer = root.querySelector('.characteristics');
    characteristicsContainer.addEventListener('change', (event) => {
        const input = event.target.closest('input.attribute');
        if (!input) return;

        const charId = input.closest('.characteristic-block').dataset.id;

        skillsBlock.querySelectorAll(
            'tr:has(input[data-id="difficulty"]), div.custom-skill'
        ).forEach((row) => {
            const sel = row.querySelector('select[data-id="characteristic"]');
            if (sel && sel.value === charId) {
                updateOneSkill(row);
            }
        });
    });

    // 7) Run one initial pass so that fields are populated on page load.
    updateAllSkills();
}


function initWeightTracker(root) {
    const carryWeightBase = root.querySelector('input[data-id="carry-weight-base"]');
    const carryWeight = root.querySelector('input[data-id="carry-weight"]');
    const liftWeight = root.querySelector('input[data-id="lift-weight"]');
    const pushWeight = root.querySelector('input[data-id="push-weight"]');
    const encumbrance = root.querySelector('input[data-id="encumbrance"]');
    const gearContainer = root.getElementById('gear');

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


function initPsykanaTracker(root) {
    const prBar = root.getElementById('pr-bar');
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

document.addEventListener('charactersheet_inserted', () => {
    const root = getRoot();
    if (!root) {
        return
    }

    makeDeletable(root.querySelector(".container"))

    const socketConnection = socket
    // initCreateItemReceiver({ socket });
    initChangeHandler()
    initBatchHandler()


    // mixins
    const settings = [
        setupColumnAddButtons,
        makeSortable,
        gridInstance => initCreateItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initDeleteItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initCreateItemHandler(gridInstance),
        gridInstance => initDeleteItemHandler(gridInstance),
        gridInstance => initPositionsChangedHandler(gridInstance),
    ]

    new ItemGrid(
        root.querySelector("#custom-skills"),
        ".custom-skill",
        CustomSkill,
        settings
    );

    new ItemGrid(
        root.querySelector("#ranged-attack"),
        ".ranged-attack",
        RangedAttack,
        settings
    );

    new ItemGrid(
        root.querySelector("#melee-attack"),
        ".melee-attack",
        MeleeAttack,
        settings,
        { sortableChildrenSelectors: ".tablabel .drag-handle" }
    );

    new ItemGrid(
        root.querySelector("#notes"),
        ".item-with-description",
        SplitTextField,
        settings
    );

    new ItemGrid(
        root.querySelector("#talents"),
        ".item-with-description",
        SplitTextField,
        settings
    );

    new ItemGrid(
        root.querySelector("#traits"),
        ".item-with-description",
        SplitTextField,
        settings
    );

    //gear
    new ItemGrid(
        root.querySelector("#gear"),
        ".gear-item",
        InventoryItemField,
        settings
    );

    new ItemGrid(
        root.querySelector("#cybernetics"),
        ".item-with-description",
        SplitTextField,
        settings
    );

    // advancements
    new ItemGrid(
        root.querySelector("#experience-log"),
        ".experience-item",
        ExperienceField,
        settings
    )

    new ItemGrid(
        root.querySelector("#mutations"),
        ".item-with-description",
        SplitTextField,
        settings
    )

    new ItemGrid(
        root.querySelector("#mental-disorders"),
        ".item-with-description",
        SplitTextField,
        settings
    )

    new ItemGrid(
        root.querySelector("#diseases"),
        ".item-with-description",
        SplitTextField,
        settings
    )

    new ItemGrid(
        root.querySelector("#psychic-powers"),
        ".psychic-power .item-with-description",
        PsychicPower,
        settings
    )

    initArmourTotals(root);
    initSkillsTable(root);
    initWeightTracker(root);
    initExperienceTracker(root);
    initPsykanaTracker(root);
});

