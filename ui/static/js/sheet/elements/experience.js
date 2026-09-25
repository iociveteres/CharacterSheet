import { computed } from "@preact/signals-core";
import { initToggleContent, initDelete, setupConditionalFields } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { getDataPath } from "../utils.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";
import { alignmentMatches } from "../system.js";

// Advancement types that derive cost from aptitudes + character state.
// All others use the stored experienceCost directly.
const CALC_TYPES = new Set(['characteristic', 'skill', 'talent']);

export class ExperienceItem {
    constructor(container, { socket, autocomplete }) {
        this.container = container;
        this._socket = socket;
        this._autocomplete = autocomplete;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'experience-item-template');
        }

        initToggleContent(this.container, {
            toggle: '.toggle-button',
            content: '.collapsible-content',
        });
        initDelete(this.container, '.delete-button');

        // Type select → show/hide relevant fields immediately and on change
        setupConditionalFields(this.container, '[data-id="type"]', {
            '.exp-field-calc': v => CALC_TYPES.has(v),
            '.exp-field-hostile': ['characteristic'],
            '.exp-field-cost': ['eliteArchetype', 'psychicPower', 'techPower', 'other'],
            '.level-talent': ['talent'],
            '.level-skill': ['skill'],
            '.level-characteristic': ['characteristic'],
        }, 'field-hidden');

        new AutocompleteOwner(this, { autocomplete, socket, collection: 'advancements' });
        container.dataset.autoExpand = 'false';
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

        return `
        <div class="ac-header">
            <span class="ac-name">${name}</span>
            ${type}${cost}
        </div>
        <div class="ac-details">${meta}${reqs}</div>`;
    }

    // ── Computed attachment (called from computed.js) ─────────────────────
}
