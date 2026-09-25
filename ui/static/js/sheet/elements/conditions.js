// Condition entries of gear items and implants. Conditions render their
// entries with Preact (blocks/ConditionEntries.tsx), which Gear and
// Cybernetics switch to when they move to Preact.
import { initDelete, setupConditionalFields } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";

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
            '.entry-name-wrap': ['char_bonus', 'char_cap', 'char_override', 'roll_bonus', 'skill_bonus'],
            '.value-char-bonus': ['char_bonus'],
            '.value-char-cap': ['char_cap'],
            '.value-char-override': ['char_override'],
            '.value-roll-bonus': ['roll_bonus'],
            '.value-skill-bonus': ['skill_bonus'],
            '.value-ablative': ['ablative_wounds'],
            '.value-initiative-bonus': ['initiative_bonus'],
            '.value-movement-bonus': ['movement_bonus'],
            '.value-bonus-ap': ['bonus_ap'],
        }, 'field-hidden');
    }
}

/**
 * Wire a condition entries grid onto any item container.
 * Used by GearItem and CyberneticImplant.
 *
 * @param {HTMLElement} container      - The item's root element
 * @param {Function}    createEntryGrid - Factory that creates an ItemGrid for entries
 * @returns {object|null} The ItemGrid instance
 */
export function initConditionEntries(container, createEntryGrid) {
    const entriesGrid = container.querySelector('[data-id="entries.items"]');
    if (!entriesGrid || !createEntryGrid) return null;
    if (!entriesGrid.id) {
        entriesGrid.id = `entries-${container.dataset.id}`;
    }
    entriesGrid._itemGridInstance = createEntryGrid(entriesGrid);

    // Wire the stub "＋ condition" button that shows when the fieldset is empty.
    // It just clicks the real add button inside the entries grid.
    const stub = container.querySelector('.add-first-condition');
    if (stub) {
        stub.addEventListener('click', () => {
            entriesGrid.querySelector('.add-button')?.click();
        });
    }

    return entriesGrid._itemGridInstance;
}