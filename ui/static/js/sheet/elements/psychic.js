import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { Dropdown } from "../elementsLayout.js";
import { initToggleContent, initDelete, applyPayload } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { getRoot } from "../utils.js";
import { getRollValue, getRollFull, initRollableDamage, rollDefaults } from "./util/rollHelpers.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";


export class PsychicPower {
    constructor(container, init, characteristicBlocks, { socket, autocomplete }) {
        this.container = container;
        this.characteristicBlocks = characteristicBlocks;
        this._socket = socket;
        this._autocomplete = autocomplete;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'psychic-power-item-template');

            this.init = {
                roll: rollDefaults.psychicPower
            };
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        this._initRollDropdown();
        initRollableDamage(this.container, () => {
            const nameInput = this.container.querySelector('[data-id="name"]');
            return nameInput?.value || 'Psychic Power';
        });

        new AutocompleteOwner(this, { autocomplete, socket, collection: 'psychicPowers' });
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

        // Initialize dropdown
        this.rollDropdown = new Dropdown({
            container: this.container,
            toggleSelector: '.split-header .name label',
            dropdownSelector: '[data-id="roll"]',
            shouldCloseOnOutsideClick: (e) => {
                return !this.container.contains(e.target);
            }
        });

        // Setup PR buttons
        this._setupPRButtons(rollContainer);

        // Setup roll button
        const rollButton = rollContainer.querySelector('[data-id="rollButton"]');
        if (rollButton) {
            rollButton.addEventListener('click', () => {
                this._handleRollClick();
                this.rollDropdown.close();
            });
        }
    }

    static attachComputeds(tabId, powerId) {
        const r = characterState.psykana?.tabs?.items?.[tabId]?.powers?.items?.[powerId]?.roll;
        if (!r) return;

        r.total = computed(() => {
            const base = getRollValue(r.baseSelect?.value);
            const modifier = Number(r.modifier?.value) || 0;
            const effectivePR = Number(r.effectivePR?.value) || 0;
            const kickPR = Number(r.kickPR?.value) || 0;
            const extra1 = (r.extra1?.enabled?.value ? Number(r.extra1?.value?.value) || 0 : 0);
            const extra2 = (r.extra2?.enabled?.value ? Number(r.extra2?.value?.value) || 0 : 0);

            return base + modifier + (effectivePR * 5) + (kickPR * 5) + extra1 + extra2;
        });
    }

    _setupPRButtons(rollContainer) {
        const root = getRoot();
        const effectivePRContainer = root.querySelector('input[data-id="effectivePR"]');

        const effectivePRInput = rollContainer.querySelector('[data-id="effectivePR"]');
        const kickPRInput = rollContainer.querySelector('[data-id="kickPR"]');

        const prZeroBtn = rollContainer.querySelector('[data-id="zeroPR"]');
        const prMaxBtn = rollContainer.querySelector('[data-id="maxPR"]');
        const kickZeroBtn = rollContainer.querySelector('[data-id="kickZero"]');
        const kickMaxBtn = rollContainer.querySelector('[data-id="kickMax"]');

        const getEffectivePR = () => {
            return parseInt(effectivePRContainer?.value, 10) || 0;
        };

        const getMaxKick = () => {
            const maxPushInput = root.querySelector('input[data-id="maxPush"]');
            return parseInt(maxPushInput?.value, 10) || 0;
        };

        if (prZeroBtn) {
            prZeroBtn.addEventListener('click', (e) => {
                e.preventDefault();
                effectivePRInput.value = 0;
                effectivePRInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }

        if (prMaxBtn) {
            prMaxBtn.addEventListener('click', (e) => {
                e.preventDefault();
                effectivePRInput.value = getEffectivePR();
                effectivePRInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }

        if (kickZeroBtn) {
            kickZeroBtn.addEventListener('click', (e) => {
                e.preventDefault();
                kickPRInput.value = 0;
                kickPRInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }

        if (kickMaxBtn) {
            kickMaxBtn.addEventListener('click', (e) => {
                e.preventDefault();
                kickPRInput.value = getMaxKick();
                kickPRInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
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

        const effectivePRInput = rollContainer.querySelector('[data-id="effectivePR"]');
        const effectivePR = parseInt(effectivePRInput?.value, 10) || 0;
        if (effectivePR > 0) {
            modifiers.push(`${effectivePR} ePR`);
        }

        const kickPRInput = rollContainer.querySelector('[data-id="kickPR"]');
        const kickPR = parseInt(kickPRInput?.value, 10) || 0;
        if (kickPR > 0) {
            modifiers.push(`+${kickPR} kick`);
        }

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
