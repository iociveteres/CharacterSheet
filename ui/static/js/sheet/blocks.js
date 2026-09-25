// Init functions for individual sheet blocks, shared between sheet kinds.
// A kind module (./kinds/*.js) picks the blocks its layout contains and calls
// them in order.
import {
    setupColumnAddButtons,
    setupSplitToggle,
    makeSortable,
    initCreateItemSender,
    initCreateItemHandler,
    initDeleteItemHandler,
    initDeleteItemSender,
    initPositionsChangedHandler,
    initMoveItemBetweenGridsHandler,
    initMoveItemBetweenGridsSender,
} from "./behaviour.js"

import { CharacteristicBlock } from "./elements/characteristics.js";
import { PowerShield } from "./elements/shields.js";
import { ArmourPart } from "./elements/armour.js";
import { TechPower } from "./elements/tech.js";
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
import { ConditionEntryRow } from "./elements/conditions.js";

import {
    ItemGrid,
    Tabs,
    Dropdown
} from "./elementsLayout.js";


// Mixins applied to a regular item grid.
export function gridSettings(socketConnection) {
    return [
        setupColumnAddButtons,
        makeSortable,
        setupSplitToggle,
        gridInstance => initCreateItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initDeleteItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initCreateItemHandler(gridInstance),
        gridInstance => initDeleteItemHandler(gridInstance),
        gridInstance => initPositionsChangedHandler(gridInstance),
    ];
}

// Mixins applied to a nested grid of entries (gear, cybernetics).
export function entryGridSettings(socketConnection) {
    return [
        setupColumnAddButtons,
        setupSplitToggle,
        gridInstance => makeSortable(gridInstance),
        gridInstance => initCreateItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initDeleteItemSender(gridInstance.container, { socket: socketConnection }),
        gridInstance => initCreateItemHandler(gridInstance),
        gridInstance => initDeleteItemHandler(gridInstance),
        gridInstance => initPositionsChangedHandler(gridInstance),
    ];
}

export function makeCreateEntryGrid(socketConnection) {
    const settings = entryGridSettings(socketConnection);
    return (gridEl) => new ItemGrid(
        gridEl,
        ".condition-entry",
        ConditionEntryRow,
        settings
    );
}


export function initCharacteristics(root) {
    const characteristicsContainer = root.querySelector('.characteristics');
    const dropdown = characteristicsContainer.querySelector('.characteristics-dropdown');
    const toggleBtn = characteristicsContainer.querySelector('.char-dropdown-toggle');

    const charKeys = ['WS', 'BS', 'S', 'T', 'A', 'I', 'P', 'W', 'F', 'Inf', 'Cor'];
    const characteristicBlocks = {};

    charKeys.forEach(key => {
        const mainBlock = characteristicsContainer.querySelector(`.main-characteristics .characteristic-block[data-id="${key}"]`);
        const permBlock = dropdown.querySelector(`#perm-characteristics .characteristic-block[data-id="${key}"]`);

        if (mainBlock && permBlock) {
            characteristicBlocks[key] = new CharacteristicBlock(key, mainBlock, permBlock);
        }
    });

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


export function initSkillsTable(root) {
    const skillsBlock = root.getElementById('skills');

    skillsBlock.addEventListener('change', (event) => {
        const target = event.target;
        const row = target.closest('tr, .custom-skill');
        if (!row) return;

        if (target.matches('input[type="checkbox"]')) {
            const checkboxes = Array.from(row.querySelectorAll('input[type="checkbox"]'));
            const idx = checkboxes.indexOf(target);

            // Checking a box fills in every box before it, unchecking clears
            // every box after it.
            if (target.checked) {
                for (let i = 0; i <= idx; i++) checkboxes[i].checked = true;
            } else {
                for (let i = idx; i < checkboxes.length; i++) checkboxes[i].checked = false;
            }

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

export function initArmourTotals(root) {
    const armourContainer = root.getElementById("armour");

    const bodyPartIds = ['head', 'leftArm', 'rightArm', 'body', 'leftLeg', 'rightLeg'];

    bodyPartIds.forEach(partId => {
        const container = armourContainer.querySelector(`.body-part[data-id="${partId}"]`);
        if (container) {
            new ArmourPart(container);
        }
    });
}

export function initCustomSkills({ root, settings }) {
    new ItemGrid(
        root.querySelector("#custom-skills"),
        ".custom-skill",
        CustomSkill,
        settings
    );
}

export function initResourceTrackers({ root, settings }) {
    new ItemGrid(
        root.querySelector("#resource-trackers"),
        ".resource-tracker",
        ResourceTracker,
        settings
    );
}

export function initPowerShields({ root, socket, autocomplete, settings }) {
    new ItemGrid(
        root.querySelector("#power-shields"),
        ".power-shield .item-with-description",
        (container, init) => new PowerShield(container, { socket, autocomplete }),
        settings
    );
}

export function initRangedAttacks({ root, socket, autocomplete, characteristicBlocks, settings }) {
    new ItemGrid(
        root.querySelector("#ranged-attack"),
        ".ranged-attack .item-with-description",
        (container, init) => new RangedAttack(container, init, characteristicBlocks, { socket, autocomplete }),
        settings
    );
}

export function initMeleeAttacks({ root, socket, autocomplete, characteristicBlocks, settings }) {
    new ItemGrid(
        root.querySelector("#melee-attack"),
        ".melee-attack .item-with-description",
        (container, init) => new MeleeAttack(container, init, characteristicBlocks, { socket, autocomplete }),
        settings,
        { sortableChildrenSelectors: ".tablabel .drag-handle" }
    );
}

export function initNotes({ root, settings }) {
    new ItemGrid(
        root.querySelector("#notes"),
        ".item-with-description",
        Note,
        settings
    );
}

export function initTalents({ root, socket, autocomplete, settings }) {
    new ItemGrid(
        root.querySelector("#talents"),
        ".item-with-description",
        (container) => new Talent(container, { socket, autocomplete }),
        settings
    );
}

export function initTraits({ root, socket, autocomplete, settings }) {
    new ItemGrid(
        root.querySelector("#traits"),
        ".item-with-description",
        (container) => new Trait(container, { socket, autocomplete }),
        settings
    );
}

export function initGear({ root, socket, autocomplete, createEntryGrid, settings }) {
    new ItemGrid(
        root.querySelector("#gear"),
        ".gear-item .item-with-description",
        container => new GearItem(container, { socket, autocomplete, createEntryGrid }),
        settings
    );
}

export function initCybernetics({ root, socket, autocomplete, createEntryGrid, settings }) {
    new ItemGrid(
        root.querySelector("#cybernetics"),
        ".item-with-description",
        (container) => new CyberneticImplant(container, {
            socket,
            autocomplete,
            createEntryGrid,
        }),
        settings
    );
}

export function initExperienceLog({ root, socket, autocomplete, settings }) {
    new ItemGrid(
        root.querySelector("#experience-log"),
        ".experience-item .item-with-description .collapsed",
        container => new ExperienceItem(container, { socket, autocomplete }),
        settings
    );
}

export function initMutations({ root, settings }) {
    new ItemGrid(
        root.querySelector("#mutations"),
        ".item-with-description",
        Mutation,
        settings
    );
}

export function initMentalDisorders({ root, settings }) {
    new ItemGrid(
        root.querySelector("#mental-disorders"),
        ".item-with-description",
        MentalDisorder,
        settings
    );
}

export function initDiseases({ root, settings }) {
    new ItemGrid(
        root.querySelector("#diseases"),
        ".item-with-description",
        Disease,
        settings
    );
}

export function initPsychicPowersTabs({ root, socket: socketConnection, characteristicBlocks, autocomplete }) {
    const psykanaContainer = root.querySelector('#psykana');
    const tabsContainer = psykanaContainer.querySelector('.tabs[data-id="tabs.items"]');

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
        gridInstance => makeSortable(gridInstance, { sharedGroup: 'psychic-powers-shared' }),
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
            ".psychic-power .item-with-description",
            (container, init) => new PsychicPower(container, init, characteristicBlocks, { socket: socketConnection, autocomplete }),
            powerGridSettings
        );
    };

    new Tabs(
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

export function initTechPowersTabs({ root, socket: socketConnection, characteristicBlocks, autocomplete }) {
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
        gridInstance => makeSortable(gridInstance, { sharedGroup: 'tech-powers-shared' }),
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

    new Tabs(
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
