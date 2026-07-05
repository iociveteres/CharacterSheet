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

import { CharacteristicBlock } from "./elements/characteristics.js";
import { PowerShield } from "./elements/shields.js";
import { ArmourPart } from "./elements/armour.js";
import { TechPower, initCompensationRoll } from "./elements/tech.js";
import { CustomSkill } from "./elements/skills.js";
import { PsychicPower } from "./elements/psychic.js";
import { ResourceTracker } from "./elements/resources.js";
import { ExperienceItem } from "./elements/experience.js";
import { GearItem } from "./elements/gear.js";
import { CyberneticImplant } from "./elements/cybernetics.js";
import { MeleeAttack } from "./elements/meleeAttack.js";
import { RangedAttack } from "./elements/rangedAttack.js";
import {
    Note,
    Trait,
    Talent,
    Mutation,
    MentalDisorder,
    Disease
} from "./elements/namedDescritpion.js";
import { ConditionItem, ConditionEntryRow } from "./elements/conditions.js";
import { initializeRollDefaults } from "./elements/util/rollHelpers.js";
import { initInitiative } from "./elements/initiative.js";
import { initMovement } from "./elements/movement.js";

import {
    initRolls
} from "./rolls.js"

import {
    Autocomplete
} from "./autocomplete.js"

import {
    ItemGrid,
    Tabs,
    Dropdown
} from "./elementsLayout.js";

import {
    socket
} from "./network.js"

import {
    initState
} from "./state/state.js"

import {
    mountBindings
} from "./state/bindings.js"

import { fatigueIndicator } from "./elements/fatigue.js";


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

        if (mainBlock && permBlock) {
            characteristicBlocks[key] = new CharacteristicBlock(key, mainBlock, permBlock);
        }
    });

    // Initialize dropdown
    const charDropdown = new Dropdown({
        container: characteristicsContainer,
        toggleSelector: '.char-dropdown-toggle',
        dropdownSelector: '.characteristics-dropdown',
        onOpen: () => { toggleBtn.textContent = '▲'; },
        onClose: () => { toggleBtn.textContent = '▼'; },
    });

    charKeys.forEach(key => {
        const mainBlock = characteristicsContainer.querySelector(`.main-characteristics .characteristic-block[data-id="${key}"]`);
        const calcValue = mainBlock?.querySelector('[data-id="calculatedValue"]');
        const calcUnnatural = mainBlock?.querySelector('[data-id="calculatedUnnatural"]');

        const openAndFocus = (focusUnnatural = false) => {
            charDropdown.open();

            const charBlock = characteristicBlocks[key];
            if (charBlock) {
                setTimeout(() => {
                    if (focusUnnatural) charBlock.permUnnatural?.focus();
                    else charBlock.permValue?.focus();
                }, 0);
            }
        };

        calcValue?.addEventListener('click', () => openAndFocus(false));
        calcUnnatural?.addEventListener('click', () => openAndFocus(true));
    });

    return characteristicBlocks;
}


function initSkillsTable(root) {
    const skillsBlock = root.getElementById('skills');

    // Attach event listener to checkboxes, characteristic selects, and misc-bonus
    skillsBlock.addEventListener('change', (event) => {
        const target = event.target;
        const row = target.closest('tr, .custom-skill');
        if (!row) return;

        // one of the upgrade‐checkboxes toggled
        if (target.matches('input[type="checkbox"]')) {
            const checkboxes = Array.from(row.querySelectorAll('input[type="checkbox"]'));
            const idx = checkboxes.indexOf(target);

            // 1) Toggle the chain of checkboxes
            if (target.checked) {
                for (let i = 0; i <= idx; i++) checkboxes[i].checked = true;
            } else {
                for (let i = idx; i < checkboxes.length; i++) checkboxes[i].checked = false;
            }

            // 2) Send fields‐updated for WebSocket
            const changes = Object.fromEntries(
                checkboxes.map(cb => [cb.dataset.id, cb.checked])
            );
            row.dispatchEvent(new CustomEvent('fieldsUpdated', {
                bubbles: true,
                detail: { changes }
            }));
        }
    });
}

function initArmourTotals(root) {
    const armourContainer = root.getElementById("armour");

    // Initialize ArmourPart instances for each body part
    const bodyParts = {};
    const bodyPartIds = ['head', 'leftArm', 'rightArm', 'body', 'leftLeg', 'rightLeg'];

    bodyPartIds.forEach(partId => {
        const container = armourContainer.querySelector(`.body-part[data-id="${partId}"]`);
        if (container) {
            bodyParts[partId] = new ArmourPart(container);
        }
    });
}


function lockUneditableInputs(root) {
    root.querySelectorAll('.uneditable').forEach(el => {
        el.setAttribute('readonly', '');
        el.setAttribute('tabindex', '-1');

        el.addEventListener('mousedown', e => e.preventDefault());
        el.addEventListener('focus', e => el.blur());
    });
}

function initCopyable(root) {
    root.querySelectorAll('.copyable').forEach(el => {
        el.addEventListener('click', async () => {
            await navigator.clipboard.writeText(el.textContent);

            el.classList.remove('copied');

            void el.offsetWidth;

            el.classList.add('copied');

            clearTimeout(el._copyTimeout);

            el._copyTimeout = setTimeout(() => {
                el.classList.remove('copied');
            }, 800);
        });
    });
}

function initPsychicPowersTabs(root, socketConnection, characteristicBlocks, autocomplete) {
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
            (container, init) => new PsychicPower(container, init, characteristicBlocks, { socket: socketConnection, autocomplete }),
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

function initTechPowersTabs(root, socketConnection, characteristicBlocks, autocomplete) {
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
            (container, init) => new TechPower(container, init, characteristicBlocks, { socket: socketConnection, autocomplete }),
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


function initConditions(root, socketConnection, autocomplete, createEntryGrid) {
    const conditionSettings = [
        setupColumnAddButtons,
        makeSortable,
        gridInstance => initCreateItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initDeleteItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initCreateItemHandler(gridInstance),
        gridInstance => initDeleteItemHandler(gridInstance),
        gridInstance => initPositionsChangedHandler(gridInstance),
    ];

    new ItemGrid(
        root.querySelector("#conditions"),
        ".condition-item",
        (container, init) => new ConditionItem(container, init, {
            createEntryGrid,
            socket: socketConnection,
            autocomplete,
        }),
        conditionSettings
    );
}


document.addEventListener('charactersheet_inserted', () => {
    const root = getRoot();
    if (!root) {
        return
    }

    initState(root);
    mountBindings(root);

    makeDeletable(root.querySelector(".container"))
    setupToggleAll(root.querySelector(".container"))
    setupHandleEnter()

    const socketConnection = socket
    initChangeHandler()
    initBatchHandler()

    const autocomplete = new Autocomplete({ socket: socketConnection, root });

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

    const entryGridSettings = [
        setupColumnAddButtons,
        setupSplitToggle,
        gridInstance => makeSortable(gridInstance),
        gridInstance => initCreateItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initDeleteItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initCreateItemHandler(gridInstance),
        gridInstance => initDeleteItemHandler(gridInstance),
        gridInstance => initPositionsChangedHandler(gridInstance),
    ];

    const createEntryGrid = (gridEl) => new ItemGrid(
        gridEl,
        ".condition-entry",
        ConditionEntryRow,
        entryGridSettings
    );

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
        (container, init) => new PowerShield(container, { socket: socketConnection, autocomplete }),
        settings
    );

    new ItemGrid(
        root.querySelector("#ranged-attack"),
        ".ranged-attack .item-with-description",
        (container, init) => new RangedAttack(container, init, characteristicBlocks, { socket: socketConnection, autocomplete }),
        settings
    );

    new ItemGrid(
        root.querySelector("#melee-attack"),
        ".melee-attack .item-with-description",
        (container, init) => new MeleeAttack(container, init, characteristicBlocks, { socket: socketConnection, autocomplete }),
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
        (container) => new Talent(container, { socket: socketConnection, autocomplete }),
        settings
    );

    new ItemGrid(
        root.querySelector("#traits"),
        ".item-with-description",
        (container) => new Trait(container, { socket: socketConnection, autocomplete }),
        settings
    );

    new ItemGrid(
        root.querySelector("#gear"),
        ".gear-item .item-with-description",
        container => new GearItem(container, { socket: socketConnection, autocomplete, createEntryGrid }),
        settings
    );

    new ItemGrid(
        root.querySelector("#cybernetics"),
        ".item-with-description",
        (container) => new CyberneticImplant(container, {
            socket: socketConnection,
            autocomplete,
            createEntryGrid,
        }),
        settings
    );

    new ItemGrid(
        root.querySelector("#experience-log"),
        ".experience-item .item-with-description .collapsed",
        container => new ExperienceItem(container, { socket: socketConnection, autocomplete }),
        settings
    );

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

    initSkillsTable(root);
    initArmourTotals(root);
    initPsychicPowersTabs(root, socketConnection, characteristicBlocks, autocomplete);
    initTechPowersTabs(root, socketConnection, characteristicBlocks, autocomplete);
    initCompensationRoll(root);
    initConditions(root, socketConnection, autocomplete, createEntryGrid);

    fatigueIndicator();

    lockUneditableInputs(root);
    initCopyable(root);

    initRolls(root, characteristicBlocks)
    initInitiative();
    initMovement();
});