import { getDataPath } from "../../utils.js";

export class AutocompleteOwner {
    /**
     * Wires autocomplete onto an item's name input, including self-cleanup on deletion.
     * The item class needs no buildQuery, onSelect, or destroy — just renderOption.
     *
     * @param {object} item             - The item instance (must have .container, .renderOption())
     * @param {object} opts
     * @param {object} opts.autocomplete - Autocomplete singleton
     * @param {WebSocket} opts.socket
     * @param {string} opts.collection   - Backend collection name
     */
    constructor(item, { autocomplete, socket, collection }) {
        const nameInput = item.container.querySelector('[data-id="name"]');
        if (!nameInput) return;

        item._nameInput = nameInput;
        this._nameInput = nameInput;
        this._socket = socket;
        this._collection = collection;
        this._item = item;

        autocomplete.register(nameInput, this);
    }

    buildQuery(query) {
        return { type: 'autocomplete', collection: this._collection, query };
    }

    onSelect(r) {
        this._nameInput.value = r.name;
        const ev = new Event('input', { bubbles: true });
        ev._noSync = true;
        this._nameInput.dispatchEvent(ev);

        const sheetID = document.getElementById('charactersheet')?.dataset?.sheetId;
        const path = getDataPath(this._item.container);
        if (!sheetID || !path) return;
        this._socket.send(JSON.stringify({
            type: 'autocompleteApply',
            eventID: crypto.randomUUID(),
            sheetID, path,
            collection: this._collection,
            name: r.name,
        }));
    }

    renderOption(r) {
        return this._item.renderOption(r);
    }
}