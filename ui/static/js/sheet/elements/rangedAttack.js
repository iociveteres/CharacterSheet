import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { Dropdown } from "../elementsLayout.js";
import { initToggleContent, initDelete, applyPayload } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { getRollValue, getRollFull, initRollableDamage, rollDefaults } from "./util/rollHelpers.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";


export class RangedAttack {
    constructor(container, init, characteristicBlocks, { socket, autocomplete }) {
        this.container = container;
        this.characteristicBlocks = characteristicBlocks;
        this.ID = container.dataset.id;
        this._socket = socket;
        this._autocomplete = autocomplete;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'ranged-attack-item-template');
            this.init = {
                roll: rollDefaults.rangedAttack
            };
        }

        this.descEl = this.container.querySelector('[data-id="description"]');
        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });

        initDelete(this.container, ".delete-button");

        this._initRollDropdown();

        initRollableDamage(this.container, () => {
            const nameInput = this.container.querySelector('[data-id="name"]');
            return nameInput?.value || 'Ranged Attack';
        });

        new AutocompleteOwner(this, { autocomplete, socket, collection: 'ranged' });
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

        // Setup roll button
        const rollButton = rollContainer.querySelector('[data-id="rollButton"]');
        if (rollButton) {
            rollButton.addEventListener('click', () => {
                this._handleRollClick();
                this.rollDropdown.close();
            });
        }
    }

    static attachComputeds(attackId) {
        const r = characterState.rangedAttacks?.list?.items?.[attackId]?.roll;
        if (!r) return;

        r.total = computed(() => {
            const base = getRollValue(r.baseSelect?.value);

            const aimSel = r.aim?.selected?.value ?? "no";
            const aim = aimSel === "half" ? (Number(r.aim?.half?.value) || 0)
                : aimSel === "full" ? (Number(r.aim?.full?.value) || 0)
                    : (Number(r.aim?.no?.value) || 0);

            const tSel = r.target?.selected?.value ?? "no";
            const targetMap = {
                torso: "torso", leg: "leg", arm: "arm",
                head: "head", joint: "joint", eyes: "eyes"
            };
            const tKey = targetMap[tSel];
            const target = tKey ? (Number(r.target?.[tKey]?.value) || 0)
                : (Number(r.target?.no?.value) || 0);

            const rSel = r.range?.selected?.value ?? "combat";
            const rangeMap = {
                melee: "melee", pointBlank: "pointBlank", short: "short",
                combat: "combat", long: "long", extreme: "extreme"
            };
            const range = Number(r.range?.[rangeMap[rSel] ?? "combat"]?.value) || 0;

            const rofSel = r.rof?.selected?.value ?? "single";
            const rofMap = {
                single: "single", short: "short", long: "long", suppression: "suppression"
            };
            const rof = Number(r.rof?.[rofMap[rofSel] ?? "single"]?.value) || 0;

            const extra1 = (r.extra1?.enabled?.value ? Number(r.extra1?.value?.value) || 0 : 0);
            const extra2 = (r.extra2?.enabled?.value ? Number(r.extra2?.value?.value) || 0 : 0);

            return base + aim + target + range + rof + extra1 + extra2;
        });
    }


    _handleRollClick() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        const totalInput = rollContainer.querySelector('[data-id="total"]');
        const target = parseInt(totalInput.value, 10) || 0;

        // Get bonus successes
        const { bonusSuccesses } = getRollFull(rollContainer, this.characteristicBlocks);

        // Build label
        const label = this._buildRollLabel(rollContainer);

        // Emit roll event
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
        const weaponName = this.container.querySelector('[data-id="name"]')?.value || 'Unknown';
        const modifiers = [];

        // Helper to get friendly name
        const getFriendlyName = (column, value) => {
            const friendlyNames = {
                aim: { half: 'half aim', full: 'full aim' },
                target: {
                    torso: 'torso', leg: 'leg', arm: 'arm',
                    head: 'head', joint: 'joint', eyes: 'eyes'
                },
                range: {
                    melee: 'melee', 'point-blank': 'point-blank',
                    short: 'short', long: 'long', extreme: 'extreme'
                },
                rof: {
                    single: 'single shot', short: 'short burst',
                    long: 'long burst', suppression: 'suppression'
                }
            };
            return friendlyNames[column]?.[value] || value;
        };

        // Default values to exclude
        const defaults = {
            aim: 'no',
            target: 'no',
            range: 'combat',
            rof: 'single'
        };

        // Check each column
        ['aim', 'target', 'range', 'rof'].forEach(columnId => {
            const column = rollContainer.querySelector(`[data-id="${columnId}"]`);
            if (!column) return;

            const selectedRadio = column.querySelector('input[type="radio"]:checked');
            if (!selectedRadio || selectedRadio.value === defaults[columnId]) return;

            modifiers.push(getFriendlyName(columnId, selectedRadio.value));
        });

        // Add extra modifiers if enabled
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
            ? `${weaponName}, ${modifiers.join(', ')}`
            : weaponName;
    }
}
