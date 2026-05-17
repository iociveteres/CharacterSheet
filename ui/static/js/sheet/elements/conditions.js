import { initDelete, setupConditionalFields } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";

export class ConditionEntryRow {
    constructor(container) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'condition-entry-template');
            this.init = { type: 'bonus_unnatural', name: '' };
        }

        initDelete(this.container, '.delete-button');

        // Update name placeholder when type changes
        const typeSelect = this.container.querySelector('[data-id="type"]');
        const nameInput = this.container.querySelector('[data-id="name"]');
        if (typeSelect && nameInput) {
            const updatePlaceholder = () => {
                nameInput.placeholder =
                    typeSelect.value === 'skill_bonus'
                        ? 'Skill (e.g. Athletics)'
                        : 'Characteristic (e.g. WS)';
            };
            updatePlaceholder();
            typeSelect.addEventListener('change', updatePlaceholder);
        }

        setupConditionalFields(this.container, '[data-id="type"]', {
            '.value-bonus-unnatural': ['bonus_unnatural'],
            '.value-roll-bonus': ['roll_bonus'],
            '.value-cap': ['cap'],
            '.value-skill-bonus': ['skill_bonus'],
        }, 'field-hidden');
    }
}

export class ConditionItem {
    constructor(container, init, { createEntryGrid, socket, autocomplete } = {}) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'condition-item-template');
            this.init = {
                enabled: true,
                entries: {
                    items: {
                        'entry-0': {
                            type: 'bonus_unnatural',
                            name: '',
                            bonus: 0,
                            unnaturalBonus: 0,
                            rollBonus: 0,
                            cap: 0,
                            skillBonus: 0,
                        }
                    },
                    layouts: {
                        'entry-0': { colIndex: 0, rowIndex: 0 }
                    }
                }
            };
        }

        initDelete(this.container, '.delete-button');

        if (autocomplete && socket) {
            new AutocompleteOwner(this, { autocomplete, socket, collection: 'conditions' });
        }

        this._initEntriesGrid(createEntryGrid);
    }

    _initEntriesGrid(createEntryGrid) {
        if (!createEntryGrid) return;
        const entriesGrid = this.container.querySelector('[data-id="entries.items"]');
        if (!entriesGrid) return;
        // Give the grid a unique id so makeSortable's else branch uses it
        // as the Sortable group name, preventing cross-condition dragging.
        if (!entriesGrid.id) {
            entriesGrid.id = `entries-${this.container.dataset.id}`;
        }
        createEntryGrid(entriesGrid);
    }

    renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        return `<div class="ac-header"><span class="ac-name">${name}</span></div>`;
    }
}