import { initToggleContent, initDelete, initPasteHandler } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";


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

export const Note = (container) => new NamedDescriptionItem(container, 'note-item-template');
export const Trait = (container) => new NamedDescriptionItem(container, 'trait-item-template');
export const Talent = (container) => new NamedDescriptionItem(container, 'talent-item-template');
export const CyberneticImplant = (container) => new NamedDescriptionItem(container, 'cybernetic-item-template');
export const Mutation = (container) => new NamedDescriptionItem(container, 'mutation-item-template');
export const MentalDisorder = (container) => new NamedDescriptionItem(container, 'mental-disorder-item-template');
export const Disease = (container) => new NamedDescriptionItem(container, 'disease-item-template');
