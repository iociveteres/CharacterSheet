import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { initToggleContent, initDelete } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { getDataPath } from "../utils.js";
import { createItemFromTemplate } from "./util/template.js";


// Advancement types that derive cost from aptitudes + character state.
// All others use the stored experienceCost directly.
const CALC_TYPES = new Set(['characteristic', 'skill', 'talent']);

export class ExperienceItem {
    constructor(container, { socket, autocomplete }) {
        this.container = container;
        this._socket = socket;
        this._autocomplete = autocomplete;
        console.log('[ExperienceItem] init', container.dataset.id, 'children:', container.children.length);

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'experience-item-template');
        }

        initToggleContent(this.container, {
            toggle: '.toggle-button',
            content: '.collapsible-content',
        });
        initDelete(this.container, '.delete-button');

        // Type select → show/hide relevant fields immediately and on change
        const typeSelect = this.container.querySelector('[data-id="type"]');
        if (typeSelect) {
            this._updateTypeVisibility(typeSelect.value);
            typeSelect.addEventListener('change', () => {
                this._updateTypeVisibility(typeSelect.value);
            });
        }

        // Autocomplete on the name input
        const nameInput = this.container.querySelector('[data-id="name"]');
        if (nameInput) {
            this._nameInput = nameInput;
            autocomplete.register(nameInput, this);
        }
    }

    // Field visibility
    _updateTypeVisibility(type) {
        const c = this.container;
        const isCalc = CALC_TYPES.has(type);
        const isChar = type === 'characteristic';
        const showCost = ['eliteArchetype', 'psychicPower', 'techPower', 'other'].includes(type);

        c.querySelectorAll('.exp-field-calc').forEach(el => el.classList.toggle('exp-hidden', !isCalc));
        c.querySelectorAll('.exp-field-hostile').forEach(el => el.classList.toggle('exp-hidden', !isChar));
        c.querySelectorAll('.exp-field-cost').forEach(el => el.classList.toggle('exp-hidden', !showCost));

        c.querySelector('.level-talent').classList.toggle('exp-hidden', type !== 'talent');
        c.querySelector('.level-skill').classList.toggle('exp-hidden', type !== 'skill');
        c.querySelector('.level-characteristic').classList.toggle('exp-hidden', type !== 'characteristic');
    }

    // Autocomplete owner interface
    buildQuery(query) {
        return {
            type: 'autocomplete',
            collection: 'advancements',
            query,
        };
    }

    renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        const type = r.type ? `<span class="ac-type">${r.type}</span>` : '';
        const cost = r.experienceCost ? `<span class="ac-cost">${r.experienceCost} xp</span>` : '';

        let meta = '';
        if (r.discipline) {
            meta += `<span class="ac-meta">${r.discipline}`;
            if (r.subdiscipline) meta += ` / ${r.subdiscipline}`;
            meta += `</span>`;
        }

        let reqs = '';
        const req = r.requirements;
        if (typeof req === 'string' && req.trim()) {
            reqs = `<span class="ac-reqs">Req: ${req.trim()}</span>`;
        } else if (req && typeof req === 'object' && !Array.isArray(req)) {
            const parts = [];
            if (req.race) parts.push(req.race);
            if (req.patron) parts.push(req.patron);
            if (Array.isArray(req.stats)) parts.push(...req.stats);
            if (req.xp_notes) parts.push(req.xp_notes);
            else if (req.xp) parts.push(`${req.xp} xp`);
            if (parts.length) reqs = `<span class="ac-reqs">Req: ${parts.join(', ')}</span>`;
        } else if (Array.isArray(req) && req.length) {
            reqs = `<span class="ac-reqs">Req: ${req.join(', ')}</span>`;
        }

        return `<div class="ac-name">${name}</div><div class="ac-details">${type}${cost}${meta}${reqs}</div>`;
    }

    onSelect(r) {
        const nameInput = this._nameInput;
        nameInput.value = r.name;
        const ev = new Event('input', { bubbles: true });
        ev._noSync = true;
        nameInput.dispatchEvent(ev);

        const sheetID = document.getElementById('charactersheet')?.dataset?.sheetId;
        const path = getDataPath(this.container);
        if (!sheetID || !path) return;
        this._socket.send(JSON.stringify({
            type: 'autocompleteApply',
            eventID: crypto.randomUUID(),
            sheetID,
            path,
            collection: 'advancements',
            name: r.name,
        }));
    }

    destroy() {
        if (this._nameInput) {
            this._autocomplete.unregister(this._nameInput);
        }
    }

    // ── Computed attachment (called from computed.js) ─────────────────────
    static attachComputeds(itemId) {
        const item = characterState.experience?.experienceLog?.items?.[itemId];
        if (!item) return;

        // Black Crusade cost tables indexed by [type][aptMatch 0-2][levelIdx]
        const COSTS = {
            characteristic: {
                2: [100, 250, 500, 750, 1000],
                1: [250, 500, 750, 1000, 1500],
                0: [500, 750, 1000, 1500, 2500],
            },
            talent: {
                2: [150, 300, 400],
                1: [250, 500, 750],
                0: [400, 750, 1000],
            },
            skill: {
                2: [100, 200, 350, 550],
                1: [200, 350, 500, 750],
                0: [300, 500, 700, 900],
            },
        };

        item.computedCost = computed(() => {
            const type = item.type?.value ?? '';
            if (!CALC_TYPES.has(type)) return Number(item?.experienceCost?.value) || 0;

            const useApt = !!characterState.experience?.useAptitudes?.value;
            const useDev = !!characterState.experience?.useDevotion?.value;

            // Start at neutral (1 match) when no toggles are active
            let matchCount = 1;

            if (useApt) {
                const itemApts = (item.aptitudes?.value ?? '')
                    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                const charApts = (characterState.experience?.aptitudes?.value ?? '')
                    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                matchCount = Math.min(2, itemApts.filter(a => charApts.includes(a)).length);
            }

            if (useDev) {
                const charGod = (characterState.experience?.alignment?.value ?? '').toLowerCase();
                if (charGod && charGod !== 'neutral') {
                    const allied = (item.alliedTo?.value ?? '')
                        .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
                    const hostile = (item.hostileTo?.value ?? '')
                        .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
                    if (allied.includes(charGod)) matchCount = Math.min(2, matchCount + 1);
                    else if (hostile.includes(charGod)) matchCount = Math.max(0, matchCount - 1);
                }
            }

            const table = COSTS[type]?.[matchCount];
            if (!table) return null;

            const raw = parseInt(item.level?.value, 10) || 1;
            const levelIdx = type === 'characteristic'
                ? Math.max(0, Math.min(4, raw - 1))
                : type === 'skill'
                    ? Math.max(0, Math.min(3, raw - 1))
                    : Math.max(0, Math.min(2, raw - 1));

            return table[levelIdx] ?? null;
        });
    }
}
