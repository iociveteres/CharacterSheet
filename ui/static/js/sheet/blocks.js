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

import { TechPower } from "./elements/tech.js";
import { PsychicPower } from "./elements/psychic.js";
import { MeleeAttack } from "./elements/meleeAttack.js";
import { RangedAttack } from "./elements/rangedAttack.js";

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
