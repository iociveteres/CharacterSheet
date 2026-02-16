import {
    makeDeletable,
    setupToggleAll,
    setupColumnAddButtons,
    setupSplitToggle,
    makeSortable,
    initCreateItemSender,
    initCreateItemHandler,
    initDeleteItemHandler,
    initDeleteItemSender,
    initChangeHandler,
    initBatchHandler,
    initPositionsChangedHandler,
    initMoveItemBetweenGridsHandler,
    initMoveItemBetweenGridsSender,
    setupHandleEnter,
} from "./behaviour.js"

import {
    mockSocket,
    getRoot
} from "./utils.js"

import {
    CharacteristicBlock,
    CustomSkill,
    Note,
    ResourceTracker,
    PowerShield,
    ArmourPart,
    RangedAttack,
    MeleeAttack,
    Trait,
    Talent,
    CyberneticImplant,
    Mutation,
    MentalDisorder,
    Disease,
    GearItem,
    ExperienceItem,
    PsychicPower,
    TechPower,
    initializeRollDefaults
} from "./elements.js";

import {
    initRolls
} from "./rolls.js"

import {
    calculateSkillAdvancement,
    calculateTestDifficulty,
    calculateCharacteristicBase,
    calculateDamageAbsorption
} from "./system.js"

import {
    ItemGrid,
    Tabs,
    Dropdown
} from "./elementsLayout.js";

import {
    socket
} from "./network.js"

function initExperienceTracker(root) {
    const totalXP = root.querySelector('input[data-id="experienceTotal"]');
    const spentXP = root.querySelector('input[data-id="experienceSpent"]');
    const remainingXP = root.querySelector('input[data-id="experienceRemaining"]');
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


function initArmourTotals(root, characteristicBlocks) {
    const armourContainer = root.getElementById("armour");
    const natural = root.querySelector('input[data-id="naturalArmourValue"]');
    const machine = root.querySelector('input[data-id="machineValue"]');
    const daemonic = root.querySelector('input[data-id="demonicValue"]');
    const other = root.querySelector('input[data-id="otherArmourValue"]');
    const toughnessBase = root.querySelector('input[data-id="toughnessBaseAbsorptionValue"]');

    // Initialize ArmourPart instances for each body part
    const bodyParts = {};
    const bodyPartIds = ['head', 'leftArm', 'rightArm', 'body', 'leftLeg', 'rightLeg'];

    bodyPartIds.forEach(partId => {
        const container = armourContainer.querySelector(`.body-part[data-id="${partId}"]`);
        if (container) {
            bodyParts[partId] = new ArmourPart(container);
        }
    });

    function updateAllTotals() {
        const naturalArmourVal = parseInt(natural?.value, 10) || 0;
        const machineVal = parseInt(machine?.value, 10) || 0;
        const daemonicVal = parseInt(daemonic?.value, 10) || 0;
        const otherArmourVal = parseInt(other?.value, 10) || 0;

        // Get toughness from characteristicBlocks
        const toughnessBlock = characteristicBlocks.T;
        const toughnessVal = toughnessBlock ? toughnessBlock.getValue() : 0;
        const toughnessUnnaturalVal = toughnessBlock ? toughnessBlock.getUnnatural() : 0;

        // Calculate base toughness
        const toughnessBaseVal = calculateCharacteristicBase(toughnessVal, toughnessUnnaturalVal);

        // Add daemonic to toughness (not to total)
        const toughnessWithDaemonic = toughnessBaseVal + daemonicVal;

        // Update each body part's total
        Object.values(bodyParts).forEach(part => {
            const armourValue = part.getArmourSum();
            const superArmourValue = part.getSuperArmour();

            // Calculate total: toughness (with daemonic) + armor + other modifiers
            const total = toughnessWithDaemonic + armourValue + naturalArmourVal + machineVal + otherArmourVal;

            part.setTotal(total, toughnessWithDaemonic, superArmourValue);
        });
    }

    function updateToughnessBase() {
        const toughnessBlock = characteristicBlocks.T;
        if (!toughnessBlock) return;

        const t = toughnessBlock.getValue();
        const tu = toughnessBlock.getUnnatural();
        const base = calculateCharacteristicBase(t, tu);
        if (toughnessBase) {
            toughnessBase.value = base;
        }
    }

    // Listen for armor changes from any body part
    armourContainer.addEventListener('armourChanged', () => {
        updateAllTotals();
    });

    // Listen for changes to modifier fields
    [natural, machine, daemonic, other].forEach(input => {
        input?.addEventListener('input', updateAllTotals);
    });

    // Listen for toughness changes
    const characteristicsContainer = root.querySelector('.characteristics');
    characteristicsContainer.addEventListener('characteristicChanged', (event) => {
        if (event.detail.charKey === 'T') {
            updateToughnessBase();
            updateAllTotals();
        }
    });

    // Initial calculations
    updateToughnessBase();
    updateAllTotals();
}

function initWoundsTracker(root) {
    const woundsMax = root.querySelector('input[data-id="woundsMax"]');
    const woundsCur = root.querySelector('input[data-id="woundsCur"]');
    const woundsRemaining = root.querySelector('input[data-id="woundsRemaining"]');

    function updateRemainingWounds() {
        const max = parseInt(woundsMax.value, 10) || 0;
        const current = parseInt(woundsCur.value, 10) || 0;
        woundsRemaining.value = max - current;
    }

    woundsMax.addEventListener('input', updateRemainingWounds);
    woundsCur.addEventListener('input', updateRemainingWounds);

    // Run once to seed the field
    updateRemainingWounds();
}

function initCharacteristics(root) {
    const characteristicsContainer = root.querySelector('.characteristics');
    const dropdown = characteristicsContainer.querySelector('.characteristics-dropdown');
    const toggleBtn = characteristicsContainer.querySelector('.char-dropdown-toggle');

    const charKeys = ['WS', 'BS', 'S', 'T', 'A', 'I', 'P', 'W', 'F', 'Inf', 'Cor'];
    const characteristicBlocks = {};

    // Initialize CharacteristicBlock for each characteristic
    charKeys.forEach(key => {
        const mainBlock = characteristicsContainer.querySelector(`.main-characteristics .characteristic-block[data-id="${key}"]`);
        const permBlock = dropdown.querySelector(`#perm-characteristics .characteristic-block[data-id="${key}"]`);
        const tempBlock = dropdown.querySelector(`#temp-characteristics .characteristic-block[data-id="${key}"]`);

        if (mainBlock && permBlock && tempBlock) {
            characteristicBlocks[key] = new CharacteristicBlock(key, mainBlock, permBlock, tempBlock);
        }
    });

    // Initialize dropdown
    const charDropdown = new Dropdown({
        container: characteristicsContainer,
        toggleSelector: '.char-dropdown-toggle',
        dropdownSelector: '.characteristics-dropdown',
        onOpen: () => {
            toggleBtn.textContent = '▲';
        },
        onClose: () => {
            toggleBtn.textContent = '▼';
        }
        // Uses default shouldCloseOnOutsideClick behavior: closes when clicking outside container
    });

    // Click on any main characteristic to open dropdown and focus permanent input
    charKeys.forEach(key => {
        const mainBlock = characteristicsContainer.querySelector(`.main-characteristics .characteristic-block[data-id="${key}"]`);
        const calcValue = mainBlock?.querySelector('[data-id="calculatedBalue"]');
        const calcUnnatural = mainBlock?.querySelector('[data-id="calculatedUnnatural"]');

        const openAndFocus = (focusUnnatural = false) => {
            charDropdown.open();

            const charBlock = characteristicBlocks[key];
            if (charBlock) {
                setTimeout(() => {
                    if (focusUnnatural) {
                        charBlock.permUnnatural?.focus();
                    } else {
                        charBlock.permValue?.focus();
                    }
                }, 0);
            }
        };

        calcValue?.addEventListener('click', () => openAndFocus(false));
        calcUnnatural?.addEventListener('click', () => openAndFocus(true));
    });

    return characteristicBlocks;
}


function initSkillsTable(root, characteristicBlocks) {
    const skillsBlock = root.getElementById('skills');

    // 1) Use characteristicBlocks instead of querying inputs directly
    const characteristics = characteristicBlocks;

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
        const charBlock = characteristics[characteristicKey];
        if (!charBlock) {
            testInput.value = '';
            return;
        }

        const characteristicValue = charBlock.getValue();

        const advanceCount = computeAdvanceCount(row);
        const advanceValue = calculateSkillAdvancement(advanceCount);

        const miscBonusInput = row.querySelector('input[data-id="miscBonus"]');
        const miscBonus = parseInt(miscBonusInput?.value, 10) || 0;

        testInput.value = calculateTestDifficulty(characteristicValue, advanceValue) + miscBonus;

        skillsBlock.dispatchEvent(new CustomEvent('skillChanged', {
            bubbles: true,
            detail: {
                skillKey: row.dataset.id,
                value: testInput.value
            }
        }));
    }

    // 4) A function that updates ALL skill‐rows at once
    function updateAllSkills() {
        skillsBlock.querySelectorAll(
            'tr:has(input[data-id="difficulty"]), div.custom-skill'
        ).forEach(updateOneSkill);
    }

    // 5) Attach event listener to checkboxes, characteristic selects, and misc-bonus
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

    // Listen for misc-bonus input changes
    skillsBlock.addEventListener('input', (event) => {
        const target = event.target;
        if (target.matches('input[data-id="miscBonus"]')) {
            const row = target.closest('tr, .custom-skill');
            if (row) {
                updateOneSkill(row);
            }
        }
    });

    // 6) Update skill difficulty when characteristic is changed
    const characteristicsContainer = root.querySelector('.characteristics');
    characteristicsContainer.addEventListener('characteristicChanged', (event) => {
        const charId = event.detail.charKey;

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

    // 8) Listen for remote updates
    skillsBlock.addEventListener('skillRecalculate', (event) => {
        const row = event.target.closest('tr, .custom-skill');
        if (row) updateOneSkill(row);
    });
}


function initWeightTracker(root) {
    const carryWeightBase = root.querySelector('input[data-id="carryWeightBase"]');
    const carryWeight = root.querySelector('input[data-id="carryWeight"]');
    const liftWeight = root.querySelector('input[data-id="liftWeight"]');
    const pushWeight = root.querySelector('input[data-id="pushWeight"]');
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
    const basePR = prBar.querySelector('input[data-id="basePR"]');
    const sustainedPowers = prBar.querySelector('input[data-id="sustainedPowers"]');
    const effectivePR = prBar.querySelector('input[data-id="effectivePR"]');

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


function lockUneditableInputs(root) {
    root.querySelectorAll('.uneditable').forEach(el => {
        el.setAttribute('readonly', '');
        el.setAttribute('tabindex', '-1');

        el.addEventListener('mousedown', e => e.preventDefault());
        el.addEventListener('focus', e => el.blur());
    });
}

function initPsychicPowersTabs(root, socketConnection, characteristicBlocks) {
    const psykanaContainer = root.querySelector('#psykana');
    const tabsContainer = psykanaContainer.querySelector('.tabs[data-id="tabs.items"]');

    // Settings for tab management
    const tabSettings = [
        tabs => initCreateItemSender(tabs.container, { socket: socketConnection }),
        tabs => initDeleteItemSender(tabs.container, { socket: socketConnection }),
        tabs => initCreateItemHandler(tabs),
        tabs => initDeleteItemHandler(tabs),
        tabs => initPositionsChangedHandler(tabs),
        tabs => initMoveItemBetweenGridsSender(tabs.container, { socket: socketConnection }),
        tabs => initMoveItemBetweenGridsHandler(tabs),
    ];

    // Settings for nested power grids (with cross-grid dragging)
    const powerGridSettings = [
        setupColumnAddButtons,
        gridInstance => makeSortable(gridInstance, {
            sharedGroup: 'psychic-powers-shared',
            onTabSwitch: (tabId) => {
                console.log('Switched to tab:', tabId);
            }
        }),
        setupSplitToggle,
        gridInstance => initCreateItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initDeleteItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initCreateItemHandler(gridInstance),
        gridInstance => initDeleteItemHandler(gridInstance),
        gridInstance => initPositionsChangedHandler(gridInstance),
    ];

    // Factory function to create ItemGrid for each tab
    const createPowerGrid = (gridEl) => {
        return new ItemGrid(
            gridEl,
            ".psychic-power .item-with-description",
            (container, init) => new PsychicPower(container, init, characteristicBlocks),
            powerGridSettings
        );
    };

    // Create tabs with nested grid factory
    const psychicTabs = new Tabs(
        tabsContainer,
        'psykana-tabs',
        tabSettings,
        {
            addBtnText: '+',
            tabLabel: '<input data-id="name" value="New Tab" />',
            tabContent: `
                <div data-id="powers.items" class="item-grid">
                    <div class="layout-column" data-column="0"></div>
                    <div class="layout-column" data-column="1"></div>
                </div>
            `,
            createNestedGrid: createPowerGrid
        }
    );
}

function initTechPowersTabs(root, socketConnection, characteristicBlocks) {
    const technoContainer = root.querySelector('#techno-arcana');
    const tabsContainer = technoContainer.querySelector('.tabs[data-id="tabs.items"]');

    const tabSettings = [
        tabs => initCreateItemSender(tabs.container, { socket: socketConnection }),
        tabs => initDeleteItemSender(tabs.container, { socket: socketConnection }),
        tabs => initCreateItemHandler(tabs),
        tabs => initDeleteItemHandler(tabs),
        tabs => initPositionsChangedHandler(tabs),
        tabs => initMoveItemBetweenGridsSender(tabs.container, { socket: socketConnection }),
        tabs => initMoveItemBetweenGridsHandler(tabs),
    ];

    const powerGridSettings = [
        setupColumnAddButtons,
        gridInstance => makeSortable(gridInstance, {
            sharedGroup: 'tech-powers-shared',
            onTabSwitch: (tabId) => {
                console.log('Switched to tab:', tabId);
            }
        }),
        setupSplitToggle,
        gridInstance => initCreateItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initDeleteItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initCreateItemHandler(gridInstance),
        gridInstance => initDeleteItemHandler(gridInstance),
        gridInstance => initPositionsChangedHandler(gridInstance),
    ];

    const createPowerGrid = (gridEl) => {
        return new ItemGrid(
            gridEl,
            ".tech-power .item-with-description",
            (container, init) => new TechPower(container, init, characteristicBlocks),
            powerGridSettings
        );
    };

    const techTabs = new Tabs(
        tabsContainer,
        'techno-tabs',
        tabSettings,
        {
            addBtnText: '+',
            tabLabel: '<input data-id="name" value="New Tab" />',
            tabContent: `
                <div data-id="powers.items" class="item-grid">
                    <div class="layout-column" data-column="0"></div>
                    <div class="layout-column" data-column="1"></div>
                </div>
            `,
            createNestedGrid: createPowerGrid
        }
    );
}

document.addEventListener('charactersheet_inserted', () => {
    const root = getRoot();
    if (!root) {
        return
    }

    makeDeletable(root.querySelector(".container"))
    setupToggleAll(root.querySelector(".container"))
    setupHandleEnter()

    const socketConnection = socket
    initChangeHandler()
    initBatchHandler()

    const characteristicBlocks = initCharacteristics(root);

    initializeRollDefaults();

    // mixins
    const settings = [
        setupColumnAddButtons,
        makeSortable,
        setupSplitToggle,
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
        root.querySelector("#resource-trackers"),
        ".resource-tracker",
        ResourceTracker,
        settings
    )

    new ItemGrid(
        root.querySelector("#power-shields"),
        ".power-shield .item-with-description",
        PowerShield,
        settings
    );

    new ItemGrid(
        root.querySelector("#ranged-attack"),
        ".ranged-attack .item-with-description",
        (container, init) => new RangedAttack(container, init, characteristicBlocks),
        settings
    );

    new ItemGrid(
        root.querySelector("#melee-attack"),
        ".melee-attack .item-with-description",
        (container, init) => new MeleeAttack(container, init, characteristicBlocks),
        settings,
        { sortableChildrenSelectors: ".tablabel .drag-handle" }
    );

    new ItemGrid(
        root.querySelector("#notes"),
        ".item-with-description",
        Note,
        settings
    );

    new ItemGrid(
        root.querySelector("#talents"),
        ".item-with-description",
        Talent,
        settings
    );

    new ItemGrid(
        root.querySelector("#traits"),
        ".item-with-description",
        Trait,
        settings
    );

    new ItemGrid(
        root.querySelector("#gear"),
        ".gear-item .item-with-description",
        GearItem,
        settings
    );

    new ItemGrid(
        root.querySelector("#cybernetics"),
        ".item-with-description",
        CyberneticImplant,
        settings
    );

    new ItemGrid(
        root.querySelector("#experience-log"),
        ".experience-item",
        ExperienceItem,
        settings
    )

    new ItemGrid(
        root.querySelector("#mutations"),
        ".item-with-description",
        Mutation,
        settings
    )

    new ItemGrid(
        root.querySelector("#mental-disorders"),
        ".item-with-description",
        MentalDisorder,
        settings
    )

    new ItemGrid(
        root.querySelector("#diseases"),
        ".item-with-description",
        Disease,
        settings
    )

    initPsychicPowersTabs(root, socketConnection, characteristicBlocks);
    initTechPowersTabs(root, socketConnection, characteristicBlocks);

    // Pass characteristicBlocks to functions that need it
    initArmourTotals(root, characteristicBlocks);
    initSkillsTable(root, characteristicBlocks);
    initWoundsTracker(root);
    initWeightTracker(root);
    initExperienceTracker(root);
    initPsykanaTracker(root);
    lockUneditableInputs(root);

    initRolls(root, characteristicBlocks)
});