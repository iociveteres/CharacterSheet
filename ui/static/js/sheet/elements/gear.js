import { initToggleContent, initDelete, setupConditionalFields, handleEntriesBatchRemote } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";
import { initConditionEntries } from "./conditions.js";

export class GearItem {
    constructor(container, { socket, autocomplete, createEntryGrid }) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'gear-item-template');
            this.init = { carried: true };
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        setupConditionalFields(this.container, '[data-id="gearType"]', {
            'fieldset.gear-armour-fields': ['armour'],
        }, 'field-hidden');

        initConditionEntries(this.container, createEntryGrid);

        new AutocompleteOwner(this, { autocomplete, socket, collection: 'gear' });

        this.container.addEventListener('batchRemote', e => {
            if (handleEntriesBatchRemote(e, this.container, 'gear.list.items')) {
                this.container.classList.remove('collapsed');
            }
        });
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