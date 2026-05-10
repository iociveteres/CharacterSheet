import { initToggleContent, initDelete, applyPayload } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";


export class GearItem {
    constructor(container, { socket, autocomplete }) {
        this.container = container;
        this._socket = socket;
        this._autocomplete = autocomplete;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'gear-item-template');
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

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
