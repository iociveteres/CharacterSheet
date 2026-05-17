import { initToggleContent, initDelete, applyPayload, setupConditionalFields } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";
import { initGearEntries } from "./conditions.js";


export class GearItem {
    constructor(container, { socket, autocomplete, createEntryGrid }) {
        this.container = container;
        this._socket = socket;
        this._autocomplete = autocomplete;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'gear-item-template');
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        setupConditionalFields(this.container, '[data-id="gearType"]', {
            'fieldset.gear-armour-fields': ['armour'],
        }, 'field-hidden');

        initGearEntries(this.container, createEntryGrid);

        new AutocompleteOwner(this, { autocomplete, socket, collection: 'gear' });
    }

    renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        const type = r.entryType ? r.entryType : "";

        return `
            <div class="ac-header">
                <span class="ac-name">${name}</span><span class="ac-type">${type}</span>
            </div>`;
    }
}