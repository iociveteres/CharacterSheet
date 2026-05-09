import { initToggleContent, initDelete, initPasteHandler } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";

export class NamedDescriptionItem {
    constructor(container, templateId) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, templateId);
        }

        // Store references to name and description elements
        this.nameEl = this.container.querySelector('[data-id="name"]');
        this.descEl = this.container.querySelector('[data-id="description"]');

        // 2) Wire up toggle and delete
        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        // 3) Paste handler to populate fields
        initPasteHandler(this.container, 'name', (text) => {
            return this.populateSplitTextField(text);
        });
    }

    setValue(text) {
        const normalized = text.replace(/\\n/g, "\n");
        const lines = normalized.split(/\r?\n/);

        this.nameEl.value = lines[0] || '';
        this.descEl.value = lines.slice(1).join("\n");
        this.syncCombined();
    }

    syncCombined() {
        this.combined = this.nameEl.value + "\n" + this.descEl.value;
    }

    populateSplitTextField(paste) {
        // Populate field values from pasted text
        const parts = paste.split(/\r?\n/);
        const name = parts[0] || '';
        const description = parts.slice(1).join("\n");

        this.nameEl.value = name;
        this.descEl.value = description;

        return { name, description };
    }
}

export class Trait extends NamedDescriptionItem {
    constructor(container, { socket, autocomplete } = {}) {
        super(container, 'trait-item-template');
        if (autocomplete && socket) {
            new AutocompleteOwner(this, { autocomplete, socket, collection: 'traits' });
        }
    }

    renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        const type = r.entryType ? r.entryType : "";

        return `
            <div class="ac-header">
                <span class="ac-name">${name}</span>${type}
            </div>`;
    }
}

export class Talent extends NamedDescriptionItem {
    constructor(container, { socket, autocomplete } = {}) {
        super(container, 'trait-item-template');
        if (autocomplete && socket) {
            new AutocompleteOwner(this, { autocomplete, socket, collection: 'talents' });
        }
    }

    renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        const type = r.entryType ? r.entryType : "";

        return `
            <div class="ac-header">
                <span class="ac-name">${name}</span>${type}
            </div>`;
    }
}

export class CyberneticImplant extends NamedDescriptionItem {
    constructor(container, { socket, autocomplete } = {}) {
        super(container, 'cybernetic-item-template');
        if (autocomplete && socket) {
            new AutocompleteOwner(this, { autocomplete, socket, collection: 'cybernetics' });
        }
    }

    renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        const type = r.entryType ? r.entryType : "";

        return `
            <div class="ac-header">
                <span class="ac-name">${name}</span>${type}
            </div>`;
    }
}

export const Note = (container) => new NamedDescriptionItem(container, 'note-item-template');
export const Mutation = (container) => new NamedDescriptionItem(container, 'mutation-item-template');
export const MentalDisorder = (container) => new NamedDescriptionItem(container, 'mental-disorder-item-template');
export const Disease = (container) => new NamedDescriptionItem(container, 'disease-item-template');