import { getRoot } from "./utils.js";

let _dropdown = null;

function getDropdown() {
    if (!_dropdown || !_dropdown.isConnected) {
        if (_dropdown) _dropdown.remove();
        _dropdown = document.createElement('div');
        _dropdown.className = 'autocomplete-dropdown';
        getRoot().appendChild(_dropdown);
    }
    return _dropdown;
}

function hideDropdown() {
    if (!_dropdown) return;
    _dropdown.style.display = 'none';
    _dropdown._owner = null;
    _dropdown._autocomplete = null;
}

document.addEventListener('pointerdown', e => {
    const d = _dropdown;
    if (!d || d.style.display === 'none') return;
    const path = e.composedPath();
    if (!path.includes(d) && !path.includes(d._owner)) hideDropdown();
}, { capture: true });

document.addEventListener('charactersheet_inserted', () => {
    if (_dropdown) {
        _dropdown.remove();
        _dropdown = null;
    }
});

// Autocomplete singleton 

export class Autocomplete {
    /**
     * @param {object} opts
     * @param {WebSocket}   opts.socket
     * @param {HTMLElement} opts.root        - Parent element to delegate input/keydown on
     * @param {number}     [opts.debounceMs=200]
     * @param {number}     [opts.minChars=1]
     */
    constructor({ socket, root, debounceMs = 200, minChars = 1 }) {
        this._socket = socket;
        this._root = root;
        this._debounceMs = debounceMs;
        this._minChars = minChars;

        // Map<HTMLInputElement, owner>
        // owner must implement: buildQuery(query), onSelect(result), renderOption(result)
        this._inputs = new Map();

        this._requestId = null;
        this._timer = null;
        this._results = [];
        this._activeIdx = -1;
        this._activeInput = null;

        this._resizeObserver = new ResizeObserver(() => this._repositionDropdown());

        this._onInput = this._onInput.bind(this);
        this._onKeydown = this._onKeydown.bind(this);
        this._onResult = e => this._handleResult(e.detail);

        root.addEventListener('input', this._onInput);
        root.addEventListener('keydown', this._onKeydown);
        document.addEventListener('sheet:autocompleteResult', this._onResult);
    }

    // Public

    /**
     * @param {HTMLInputElement} input
     * @param {object} owner - Must implement buildQuery, onSelect, renderOption
     */
    register(input, owner) {
        this._inputs.set(input, owner);
    }

    unregister(input) {
        if (this._activeInput === input) {
            this._deactivate();
        }
        this._inputs.delete(input);
    }

    /** Detach all listeners. Call on sheet teardown. */
    destroy() {
        clearTimeout(this._timer);
        hideDropdown();
        this._root.removeEventListener('input', this._onInput);
        this._root.removeEventListener('keydown', this._onKeydown);
        document.removeEventListener('sheet:autocompleteResult', this._onResult);
        this._resizeObserver.disconnect();
        this._inputs.clear();
    }

    // Private

    _deactivate() {
        clearTimeout(this._timer);
        this._resizeObserver.disconnect();
        hideDropdown();
        this._activeInput = null;
        this._results = [];
        this._activeIdx = -1;
        this._requestId = null;
    }

    _repositionDropdown() {
        const d = _dropdown;
        if (!d || d._owner !== this._activeInput || d.style.display === 'none') return;
        const rect = this._activeInput.getBoundingClientRect();
        d.style.left = `${rect.left}px`;
        d.style.top = `${rect.bottom}px`;
        d.style.width = `${rect.width}px`;
    }

    _onInput(e) {
        const input = e.target;
        const owner = this._inputs.get(input);
        if (!owner) return;

        clearTimeout(this._timer);
        const q = input.value.trim();
        if (q.length < this._minChars) {
            if (this._activeInput === input) this._deactivate();
            return;
        }

        this._activeInput = input;
        this._timer = setTimeout(() => this._send(input, owner, q), this._debounceMs);
    }

    _send(input, owner, query) {
        this._requestId = crypto.randomUUID();
        const msg = { ...owner.buildQuery(query), eventID: this._requestId };
        this._socket.send(JSON.stringify(msg));
    }

    _handleResult({ requestId, results }) {
        if (requestId !== this._requestId) return;
        this._results = results ?? [];
        this._activeIdx = -1;
        this._render();
    }

    _render() {
        const input = this._activeInput;
        if (!input) return;

        const owner = this._inputs.get(input);
        if (!owner) return;

        const d = getDropdown();
        if (this._results.length === 0) {
            hideDropdown();
            return;
        }

        d.innerHTML = this._results
            .map((r, i) => `<div class="autocomplete-option" data-idx="${i}">${owner.renderOption(r)}</div>`)
            .join('');

        d._owner = input;
        d._autocomplete = this;

        const rect = input.getBoundingClientRect();
        d.style.display = 'block';
        d.style.position = 'fixed';
        d.style.left = `${rect.left}px`;
        d.style.top = `${rect.bottom}px`;
        d.style.width = `${rect.width}px`;
        d.style.zIndex = '9999';

        d.onmousedown = e => {
            e.preventDefault();
            const opt = e.target.closest('.autocomplete-option');
            if (!opt) return;
            const result = this._results[parseInt(opt.dataset.idx, 10)];
            if (result) {
                owner.onSelect(result);
                this._deactivate();
            }
        };

        this._resizeObserver.disconnect();
        this._resizeObserver.observe(input);
    }

    _onKeydown(e) {
        const input = e.target;
        if (!this._inputs.has(input)) return;

        const d = _dropdown;
        if (!d || d.style.display === 'none' || d._owner !== input) return;

        const items = d.querySelectorAll('.autocomplete-option');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this._activeIdx = Math.min(this._activeIdx + 1, items.length - 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this._activeIdx = Math.max(this._activeIdx - 1, 0);
        } else if (e.key === 'Enter' && this._activeIdx >= 0) {
            e.preventDefault();
            const result = this._results[this._activeIdx];
            const owner = this._inputs.get(input);
            if (result && owner) {
                owner.onSelect(result);
                this._deactivate();
            }
            return;
        } else if (e.key === 'Escape') {
            this._deactivate();
            return;
        } else {
            return;
        }

        items.forEach((el, i) => el.classList.toggle('active', i === this._activeIdx));
        items[this._activeIdx]?.scrollIntoView({ block: 'nearest' });
    }
}