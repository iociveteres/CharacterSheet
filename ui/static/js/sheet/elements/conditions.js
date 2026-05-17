import { initDelete, setupConditionalFields } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";
import { bumpItemVersion } from "../state/sync.js";

export class ConditionEntryRow {
    constructor(container) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'condition-entry-template');
            this.init = { type: 'char_bonus', name: '' };
        }

        initDelete(this.container, '.delete-button');

        const typeSelect = this.container.querySelector('[data-id="type"]');
        const nameInput = this.container.querySelector('[data-id="name"]');
        if (typeSelect && nameInput) {
            const updatePlaceholder = () => {
                nameInput.placeholder =
                    typeSelect.value === 'skill_bonus' ? 'Skill name'
                        : 'Characteristic (e.g. WS)';
            };
            updatePlaceholder();
            typeSelect.addEventListener('change', updatePlaceholder);
        }

        setupConditionalFields(this.container, '[data-id="type"]', {
            '.entry-name-wrap': ['char_bonus', 'char_cap', 'roll_bonus', 'skill_bonus'],
            '.value-char-bonus': ['char_bonus'],
            '.value-char-cap': ['char_cap'],
            '.value-roll-bonus': ['roll_bonus'],
            '.value-skill-bonus': ['skill_bonus'],
            '.value-ablative': ['ablative_wounds'],
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
                            type: 'char_bonus', name: '',
                            bonus: 0, unnaturalBonus: 0,
                            rollBonus: 0, cap: 0, skillBonus: 0, ablativeWounds: 0,
                        }
                    },
                    layouts: { 'entry-0': { colIndex: 0, rowIndex: 0 } }
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
        if (!entriesGrid.id) {
            entriesGrid.id = `entries-${this.container.dataset.id}`;
        }

        // When entries are added/removed, bump the parent conditions version
        // so characteristic computeds re-run immediately.
        entriesGrid.addEventListener('createItemLocal', () => {
            bumpItemVersion('conditions.list.items');
        });
        entriesGrid.addEventListener('deleteItemLocal', () => {
            bumpItemVersion('conditions.list.items');
        });

        createEntryGrid(entriesGrid);
    }

    renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        return `<div class="ac-header"><span class="ac-name">${name}</span></div>`;
    }
}

// Used by GearItem to wire its entries grid.
export function initGearEntries(container, createEntryGrid) {
    const entriesGrid = container.querySelector('[data-id="entries.items"]');
    if (!entriesGrid || !createEntryGrid) return;
    if (!entriesGrid.id) {
        entriesGrid.id = `entries-${container.dataset.id}`;
    }

    // Bump gear version when entries are added/removed so computeds re-run.
    entriesGrid.addEventListener('createItemLocal', () => {
        bumpItemVersion('gear.list.items');
    });
    entriesGrid.addEventListener('deleteItemLocal', () => {
        bumpItemVersion('gear.list.items');
    });

    createEntryGrid(entriesGrid);
}