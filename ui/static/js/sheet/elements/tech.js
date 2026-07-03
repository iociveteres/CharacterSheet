import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { Dropdown } from "../elementsLayout.js";
import { initToggleContent, initDelete, applyPayload } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { getRollValue, getRollFull, initRollableDamage, rollDefaults } from "./util/rollHelpers.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";
import { calculateBonusSuccesses } from "../system.js";


export class TechPower {
    constructor(container, init, characteristicBlocks, { socket, autocomplete }) {
        this.container = container;
        this.characteristicBlocks = characteristicBlocks;
        this._socket = socket;
        this._autocomplete = autocomplete;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'tech-power-item-template');

            this.init = {
                roll: rollDefaults.techPower
            };
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        this._initRollDropdown();
        initRollableDamage(this.container, () => {
            const nameInput = this.container.querySelector('[data-id="name"]');
            return nameInput?.value || 'Tech Power';
        });

        new AutocompleteOwner(this, { autocomplete, socket, collection: 'techPowers' });
    }

    renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        const type = r.entryType ? r.entryType : "";

        return `
            <div class="ac-header">
                <span class="ac-name">${name}</span><span class="ac-type">${type}</span>
            </div>`;
    }

    _initRollDropdown() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        if (!rollContainer) return;

        const nameLabel = this.container.querySelector('.split-header .name label');
        if (!nameLabel) return;

        this.rollDropdown = new Dropdown({
            container: this.container,
            toggleSelector: '.split-header .name label',
            dropdownSelector: '[data-id="roll"]',
            shouldCloseOnOutsideClick: (e) => {
                return !this.container.contains(e.target);
            }
        });

        const rollButton = rollContainer.querySelector('[data-id="rollButton"]');
        if (rollButton) {
            rollButton.addEventListener('click', () => {
                this._handleRollClick();
                this.rollDropdown.close();
            });
        }
    }

    static attachComputeds(tabId, powerId) {
        const r = characterState.technoArcana?.tabs?.items?.[tabId]?.powers?.items?.[powerId]?.roll;
        if (!r) return;

        r.total = computed(() => {
            const base = getRollValue(r.baseSelect?.value);
            const modifier = Number(r.modifier?.value) || 0;
            const extra1 = (r.extra1?.enabled?.value ? Number(r.extra1?.value?.value) || 0 : 0);
            const extra2 = (r.extra2?.enabled?.value ? Number(r.extra2?.value?.value) || 0 : 0);

            return base + modifier + extra1 + extra2;
        });
    }

    _handleRollClick() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        const totalInput = rollContainer.querySelector('[data-id="total"]');
        const target = parseInt(totalInput.value, 10) || 0;

        const { bonusSuccesses } = getRollFull(rollContainer, this.characteristicBlocks);
        const label = this._buildRollLabel(rollContainer);

        document.dispatchEvent(new CustomEvent('sheet:rollVersus', {
            bubbles: true,
            detail: {
                target: target,
                bonusSuccesses: bonusSuccesses,
                label: label
            }
        }));
    }

    _buildRollLabel(rollContainer) {
        const powerName = this.container.querySelector('[data-id="name"]')?.value || 'Unknown Power';
        const modifiers = [];

        ['extra1', 'extra2'].forEach(extraId => {
            const extra = rollContainer.querySelector(`[data-id="${extraId}"]`);
            if (!extra) return;

            const checkbox = extra.querySelector('[data-id="enabled"]');
            const nameInput = extra.querySelector('[data-id="name"]');

            if (checkbox?.checked && nameInput?.value) {
                modifiers.push(nameInput.value);
            }
        });

        return modifiers.length > 0
            ? `${powerName}, ${modifiers.join(', ')}`
            : powerName;
    }
}

// Compensation roll

export function attachCompensationComputed() {
    const r = characterState.technoArcana?.compensationRoll;
    if (!r) return;

    r.total = computed(() => {
        const char = characterState.characteristics?.T;
        const base = char?.valueForRolls?.value ?? 0;
        const modifier = Number(r.modifier?.value) || 0;
        const extra1 = (r.extra1?.enabled?.value ? Number(r.extra1?.value?.value) || 0 : 0);
        const extra2 = (r.extra2?.enabled?.value ? Number(r.extra2?.value?.value) || 0 : 0);

        return base - (10 * modifier) + extra1 + extra2;
    });
}

export function initCompensationRoll(root) {
    const wrapper = root.querySelector('[data-id="compensationRoll"]');
    if (!wrapper) return;

    const rollContainer = wrapper.querySelector('.roll-dropdown');
    if (!rollContainer) return;

    const dropdown = new Dropdown({
        container: wrapper,
        toggleSelector: '.compensation-toggle',
        dropdownSelector: '.roll-dropdown',
        shouldCloseOnOutsideClick: (e) => !wrapper.contains(e.target)
    });

    const rollButton = rollContainer.querySelector('[data-id="rollButton"]');
    if (rollButton) {
        rollButton.addEventListener('click', () => {
            _handleCompensationRollClick(rollContainer);
            dropdown.close();
        });
    }
}

function _handleCompensationRollClick(rollContainer) {
    const totalInput = rollContainer.querySelector('[data-id="total"]');
    const target = parseInt(totalInput.value, 10) || 0;

    const char = characterState.characteristics?.T;
    const bonusSuccesses = calculateBonusSuccesses(char?.calculatedUnnatural?.value ?? 0);

    document.dispatchEvent(new CustomEvent('sheet:rollVersus', {
        bubbles: true,
        detail: {
            target,
            bonusSuccesses,
            label: _buildCompensationRollLabel(rollContainer)
        }
    }));
}

function _buildCompensationRollLabel(rollContainer) {
    const modifiers = [];

    const xInput = rollContainer.querySelector('[data-id="modifier"]');
    const modifier = parseInt(xInput?.value, 10) || 0;
    modifiers.push(`X = ${modifier}`);

    ['extra1', 'extra2'].forEach(extraId => {
        const extra = rollContainer.querySelector(`[data-id="${extraId}"]`);
        if (!extra) return;

        const checkbox = extra.querySelector('[data-id="enabled"]');
        const nameInput = extra.querySelector('[data-id="name"]');

        if (checkbox?.checked && nameInput?.value) {
            modifiers.push(nameInput.value);
        }
    });

    return modifiers.length > 0
        ? `Compensator, ${modifiers.join(', ')}`
        : 'Compensator';
}