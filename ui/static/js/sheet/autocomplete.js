import { getRoot } from "./utils.js";

let _dropdown = null;

function getDropdown() {
    // Recreate if stale (shadow root was replaced on sheet reload)
    if (!_dropdown || !_dropdown.isConnected) {
        if (_dropdown) _dropdown.remove();
        _dropdown = document.createElement('div');
        _dropdown.className = 'autocomplete-dropdown';
        getRoot().appendChild(_dropdown);
    }
    return _dropdown;
}

function hideDropdown() {
    const d = _dropdown;
    if (!d) return;
    d.style.display = 'none';
    d._owner = null;
    d._autocomplete = null;
}

// Close when clicking outside. Events from shadow DOM are retargeted at the
// boundary, so e.target would be the host element — use composedPath() instead
// to inspect the real path through the shadow tree.
document.addEventListener('pointerdown', e => {
    const d = _dropdown;
    if (!d || d.style.display === 'none') return;
    const path = e.composedPath();
    if (!path.includes(d) && !path.includes(d._owner)) hideDropdown();
}, { capture: true });

// Null out stale dropdown ref when the sheet is replaced so getDropdown()
// recreates it in the new shadow root on next use.
document.addEventListener('charactersheet_inserted', () => {
    if (_dropdown) {
        _dropdown.remove();
        _dropdown = null;
    }
});

// ─── Autocomplete class ───────────────────────────────────────────────────────

export class Autocomplete {
    /**
     * @param {object} opts
     * @param {HTMLInputElement}           opts.input         - The input to attach to
     * @param {(query:string) => object}   opts.buildQuery    - Returns the WS message object (without eventID)
     * @param {(result:object) => string}  opts.renderOption  - Returns inner HTML for one result row
     * @param {(result:object) => void}    opts.onSelect      - Called when user picks an option
     * @param {WebSocket}                  opts.socket        - The WebSocket instance
     * @param {number} [opts.debounceMs=200]
     * @param {number} [opts.minChars=1]
     */
    constructor({ input, socket, buildQuery, renderOption, onSelect, debounceMs = 200, minChars = 1 }) {
        this._input = input;
        this._socket = socket;
        this._buildQuery = buildQuery;
        this._renderOption = renderOption;
        this._onSelect = onSelect;
        this._debounceMs = debounceMs;
        this._minChars = minChars;

        this._requestId = null;
        this._timer = null;
        this._results = [];
        this._activeIdx = -1;

        this._onInputBound = () => this._onInput();
        this._onKeydownBound = e => this._onKeydown(e);
        this._onResultBound = e => this._onResult(e.detail);

        input.addEventListener('input', this._onInputBound);
        input.addEventListener('keydown', this._onKeydownBound);
        // No focus listener — dropdown opens only on actual user input.
        document.addEventListener('sheet:autocompleteResult', this._onResultBound);

        this._resizeObserver = new ResizeObserver(() => this._repositionDropdown());
        this._resizeObserver.observe(input);
    }

    // ── Private ────────────────────────────────────────────────────────────

    _repositionDropdown() {
        const d = _dropdown;
        if (!d || d._owner !== this._input || d.style.display === 'none') return;
        const rect = this._input.getBoundingClientRect();
        d.style.left = `${rect.left}px`;
        d.style.top = `${rect.bottom}px`;
        d.style.width = `${rect.width}px`;
    }

    _onInput() {
        clearTimeout(this._timer);
        const q = this._input.value.trim();
        if (q.length < this._minChars) {
            hideDropdown();
            return;
        }
        this._timer = setTimeout(() => this._send(q), this._debounceMs);
    }

    _send(query) {
        this._requestId = crypto.randomUUID();
        const msg = { ...this._buildQuery(query), eventID: this._requestId };
        this._socket.send(JSON.stringify(msg));
    }

    _onResult({ requestId, results }) {
        if (requestId !== this._requestId) return; // stale, discard
        this._results = results ?? [];
        this._activeIdx = -1;
        this._render();
    }

    _render() {
        const d = getDropdown();
        if (this._results.length === 0) {
            hideDropdown();
            return;
        }

        d.innerHTML = this._results
            .map((r, i) => `<div class="autocomplete-option" data-idx="${i}">${this._renderOption(r)}</div>`)
            .join('');

        d._owner = this._input;
        d._autocomplete = this;

        const rect = this._input.getBoundingClientRect();
        d.style.cssText = `
            display: block;
            position: fixed;
            left: ${rect.left}px;
            top: ${rect.bottom}px;
            width: ${rect.width}px;
            z-index: 9999;
        `;

        // mousedown + preventDefault: fires before blur, keeps input focused,
        // and the pointerdown outside-click guard won't close us on the same event.
        d.onmousedown = e => {
            e.preventDefault();
            const opt = e.target.closest('.autocomplete-option');
            if (!opt) return;
            const result = this._results[parseInt(opt.dataset.idx, 10)];
            if (result) {
                this._onSelect(result);
                hideDropdown();
            }
        };
    }

    _onKeydown(e) {
        const d = _dropdown;
        if (!d || d.style.display === 'none' || d._owner !== this._input) return;

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
            if (result) {
                this._onSelect(result);
                hideDropdown();
            }
            return;
        } else if (e.key === 'Escape') {
            hideDropdown();
            return;
        } else {
            return;
        }

        items.forEach((el, i) => el.classList.toggle('active', i === this._activeIdx));
        items[this._activeIdx]?.scrollIntoView({ block: 'nearest' });
    }

    /** Detach all listeners and observers. Call when the owner element is removed. */
    destroy() {
        clearTimeout(this._timer);
        if (_dropdown?._owner === this._input) hideDropdown();
        this._input.removeEventListener('input', this._onInputBound);
        this._input.removeEventListener('keydown', this._onKeydownBound);
        document.removeEventListener('sheet:autocompleteResult', this._onResultBound);
        this._resizeObserver.disconnect();
    }
}