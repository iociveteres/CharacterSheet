import { initToggleContent, initDelete, setupConditionalFields, rebuildGridFromBatch } from "../elementsUtils.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";
import { initGearEntries } from "./conditions.js";
import { applyBatch } from "../utils.js";
import { updateSignalBatch, bumpItemVersion } from "../state/sync.js";


export class GearItem {
    constructor(container, { socket, autocomplete, createEntryGrid }) {
        this.container = container;
        this._socket = socket;
        this._autocomplete = autocomplete;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'gear-item-template');
            this.init = { carried: true };
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        setupConditionalFields(this.container, '[data-id="gearType"]', {
            'fieldset.gear-armour-fields': ['armour'],
        }, 'field-hidden');

        this._entriesGrid = initGearEntries(this.container, createEntryGrid);

        new AutocompleteOwner(this, { autocomplete, socket, collection: 'gear' });

        this.container.addEventListener('batchRemote', e => this._handleBatchRemote(e));
    }

    _handleBatchRemote(e) {
        const { changes, path } = e.detail;
        if (!changes?.entries?.items) return;

        e.stopPropagation();

        const { entries, ...topLevel } = changes;
        if (Object.keys(topLevel).length) {
            applyBatch(this.container, topLevel);
            updateSignalBatch(path, topLevel);
        }

        const entriesGrid = this.container.querySelector('[data-id="entries.items"]');
        if (entriesGrid) {
            rebuildGridFromBatch(entriesGrid, '.condition-entry', entries);
        }

        bumpItemVersion('gear.list.items');

        if (this.container.dataset.autoExpand !== 'false') {
            this.container.classList.remove('collapsed');
        }
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