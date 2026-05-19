import { initToggleContent, initDelete, handleEntriesBatchRemote } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";
import { initConditionEntries } from "./conditions.js";

export class CyberneticImplant {
    constructor(container, { socket, autocomplete, createEntryGrid } = {}) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'cybernetic-item-template');
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        initConditionEntries(this.container, createEntryGrid, 'cybernetics.list.items');

        if (autocomplete && socket) {
            new AutocompleteOwner(this, { autocomplete, socket, collection: 'cybernetics' });
        }

        this.container.addEventListener('batchRemote', e => {
            if (handleEntriesBatchRemote(e, this.container, 'cybernetics.list.items')) {
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