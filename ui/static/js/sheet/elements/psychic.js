import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { Dropdown } from "../elementsLayout.js";
import { initToggleContent, initDelete, initPasteHandler, applyPayload } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { getRoot } from "../utils.js";
import { getRollValue, getRollFull, initRollableDamage, rollDefaults } from "./util/rollHelpers.js";
import { createItemFromTemplate } from "./util/template.js";


/**
 * Extract both the weapon profile and RoF values from the effect text.
 *
 * @param {string} effect    Effect text for the textarea
 * @param {string} subtypes  The comma-separated subtypes string
 * @returns {{
 *   rng: string,
 *   dmg: string,
 *   type: string,
 *   pen: string,
 *   props: string,
 *   rofSingle: string,
 *   rofShort: string,
 *   rofLong: string
 * }}
 */
function parsePsychicPowerProfile(effect, subtypes) {
    // —–––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
    // 1) Weapon profile
    const lines = effect.split(/\r?\n/);
    const hdrIdx = lines.findIndex(l => /^\s*Rng\b/i.test(l));
    let rng = '', dmg = '', type = '', pen = '', props = '';
    if (hdrIdx !== -1 && lines[hdrIdx + 1]) {
        let row = lines[hdrIdx + 1].trim();
        if (lines[hdrIdx + 2] && !/^[A-ZА-ЯЁ]/i.test(lines[hdrIdx + 2].trim())) {
            row += ' ' + lines[hdrIdx + 2].trim();
        }

        const headerTokens = lines[hdrIdx].trim().split(/\s+/);
        const hasBl = headerTokens.includes('Bl');
        const hasRoF = headerTokens.includes('RoF');

        if (hasBl) {
            row = row.split(/\s+/).slice(0, -1).join(' ');
        }

        const rx = hasRoF
            ? /^(\S+)\s+(?:\S+\/\S+\/\S+\s+)?(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/
            : /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/;

        const m = row.match(rx);
        if (m) {
            [, rng, dmg, type, pen, props] = m;

            if (dmg.length == 1) {
                let propsContinued = '';
                [, rng, dmg, pen, props, propsContinued] = m;
                props += propsContinued;
            }
            if (/[½\/]/.test(pen)) {
                const parenMatch = props.match(/^[^)]*\)/);
                if (parenMatch) {
                    pen += ' ' + parenMatch[0];
                    props = props.slice(parenMatch[0].length).trim();
                }
            }
        }
    }

    // —–––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
    // 2) RoF via helper function
    const [rofSingle, rofShort, rofLong] = getPsychicRoF(lines, subtypes);

    return { rng, dmg, type, pen, props, rofSingle, rofShort, rofLong };
}
function getPsychicRoF(lines, subtypes) {
    // 1) Try to find a RoF column in the table
    const hdrIdx = lines.findIndex(l => /^\s*Rng\b.*\bRoF\b/i.test(l));
    if (hdrIdx !== -1 && lines[hdrIdx + 1]) {
        let row = lines[hdrIdx + 1].trim();
        const m = row.match(/^\S+\s+(\S+)\s+\S+\s+\S+\s+\S+/);
        if (m) {
            return m[1].split('/'); // ["S","2","все"], for example
        }
    }

    // 2) Fallback to subtype map
    const rofMap = {
        'психический снаряд': ['1', '-', '-'],
        'психический обстрел': ['-', '∞', '-'],
        'психический шторм': ['-', '-', '∞'],
        'психический взрыв': ['1', '-', '-'],
        'психическое дыхание': ['1', '-', '-']
    };

    // normalize and strip any "(…)" suffix
    const subs = subtypes
        .toLowerCase()
        .split(',')
        .map(s => s.trim().replace(/\s*\(.*\)$/, ''));

    const key = Object.keys(rofMap).find(k => subs.includes(k));
    return key ? rofMap[key] : ['-', '-', '-'];
}


export class PsychicPower {
    constructor(container, init, characteristicBlocks) {
        this.container = container;
        this.characteristicBlocks = characteristicBlocks;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'psychic-power-item-template');

            this.init = {
                roll: rollDefaults.psychicPower
            };
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        initPasteHandler(this.container, 'name', (text) => {
            return this.populatePsychicPower(text);
        });

        this._initRollDropdown();
        initRollableDamage(this.container, () => {
            const nameInput = this.container.querySelector('[data-id="name"]');
            return nameInput?.value || 'Psychic Power';
        });
    }

    _initRollDropdown() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        if (!rollContainer) return;

        const nameLabel = this.container.querySelector('.split-header .name label');
        if (!nameLabel) return;

        // Initialize dropdown
        this.rollDropdown = new Dropdown({
            container: this.container,
            toggleSelector: '.split-header .name label',
            dropdownSelector: '[data-id="roll"]',
            shouldCloseOnOutsideClick: (e) => {
                return !this.container.contains(e.target);
            }
        });

        // Setup PR buttons
        this._setupPRButtons(rollContainer);

        // Setup roll button
        const rollButton = rollContainer.querySelector('[data-id="rollButton"]');
        if (rollButton) {
            rollButton.addEventListener('click', () => {
                this._handleRollClick();
                this.rollDropdown.close();
            });
        }
    }

    static attachComputeds(tabId, powerId) {
        const r = characterState.psykana?.tabs?.items?.[tabId]?.powers?.items?.[powerId]?.roll;
        if (!r) return;

        r.total = computed(() => {
            const base = getRollValue(r.baseSelect?.value);
            const modifier = Number(r.modifier?.value) || 0;
            const effectivePR = Number(r.effectivePR?.value) || 0;
            const kickPR = Number(r.kickPR?.value) || 0;
            const extra1 = (r.extra1?.enabled?.value ? Number(r.extra1?.value?.value) || 0 : 0);
            const extra2 = (r.extra2?.enabled?.value ? Number(r.extra2?.value?.value) || 0 : 0);

            return base + modifier + (effectivePR * 5) + (kickPR * 5) + extra1 + extra2;
        });
    }

    _setupPRButtons(rollContainer) {
        const root = getRoot();
        const effectivePRContainer = root.querySelector('input[data-id="effectivePR"]');

        const effectivePRInput = rollContainer.querySelector('[data-id="effectivePR"]');
        const kickPRInput = rollContainer.querySelector('[data-id="kickPR"]');

        const prZeroBtn = rollContainer.querySelector('[data-id="zeroPR"]');
        const prMaxBtn = rollContainer.querySelector('[data-id="maxPR"]');
        const kickZeroBtn = rollContainer.querySelector('[data-id="kickZero"]');
        const kickMaxBtn = rollContainer.querySelector('[data-id="kickMax"]');

        const getEffectivePR = () => {
            return parseInt(effectivePRContainer?.value, 10) || 0;
        };

        const getMaxKick = () => {
            const maxPushInput = root.querySelector('input[data-id="maxPush"]');
            return parseInt(maxPushInput?.value, 10) || 0;
        };

        if (prZeroBtn) {
            prZeroBtn.addEventListener('click', (e) => {
                e.preventDefault();
                effectivePRInput.value = 0;
                effectivePRInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }

        if (prMaxBtn) {
            prMaxBtn.addEventListener('click', (e) => {
                e.preventDefault();
                effectivePRInput.value = getEffectivePR();
                effectivePRInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }

        if (kickZeroBtn) {
            kickZeroBtn.addEventListener('click', (e) => {
                e.preventDefault();
                kickPRInput.value = 0;
                kickPRInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }

        if (kickMaxBtn) {
            kickMaxBtn.addEventListener('click', (e) => {
                e.preventDefault();
                kickPRInput.value = getMaxKick();
                kickPRInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
    }

    _handleRollClick() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        const totalInput = rollContainer.querySelector('[data-id="total"]');
        const target = parseInt(totalInput.value, 10) || 0;

        const { bonusSuccesses } = getRollFull(rollContainer, this.characteristicBlocks);

        const label = this._buildRollLabel(rollContainer);

        document.dispatchEvent(new CustomEvent('sheet:rollVersus', {
            bubbles: true,
            detail: {
                target: target,
                bonusSuccesses: bonusSuccesses,
                label: label
            }
        }));
    }

    _buildRollLabel(rollContainer) {
        const powerName = this.container.querySelector('[data-id="name"]')?.value || 'Unknown Power';
        const modifiers = [];

        const effectivePRInput = rollContainer.querySelector('[data-id="effectivePR"]');
        const effectivePR = parseInt(effectivePRInput?.value, 10) || 0;
        if (effectivePR > 0) {
            modifiers.push(`${effectivePR} ePR`);
        }

        const kickPRInput = rollContainer.querySelector('[data-id="kickPR"]');
        const kickPR = parseInt(kickPRInput?.value, 10) || 0;
        if (kickPR > 0) {
            modifiers.push(`+${kickPR} kick`);
        }

        ['extra1', 'extra2'].forEach(extraId => {
            const extra = rollContainer.querySelector(`[data-id="${extraId}"]`);
            if (!extra) return;

            const checkbox = extra.querySelector('[data-id="enabled"]');
            const nameInput = extra.querySelector('[data-id="name"]');

            if (checkbox?.checked && nameInput?.value) {
                modifiers.push(nameInput.value);
            }
        });

        return modifiers.length > 0
            ? `${powerName}, ${modifiers.join(', ')}`
            : powerName;
    }

    // Populate field values from pasted string
    parsePsychicPower(paste) {
        const text = paste;

        const extract = (regex, fallback = '') => {
            const match = text.match(regex);
            return match ? match[1].trim() : fallback;
        };

        const name = extract(/^([^\/]*)/m);
        const action = extract(/действие:\s*([\s\S]*?)\s*поддержание:/i);
        const sustained = extract(/поддержание:\s*(.*)$/im);
        const psychotest = extract(/психотест:\s*([\s\S]*?)\s*дальность:/i);
        const range = extract(/дальность:\s*(.*)$/im);
        const subtypes = extract(/тип:\s*(.*)$/im);
        const effect = extract(/эффект:\s*([\s\S]*)$/i);

        const profile = parsePsychicPowerProfile(effect, subtypes);

        const container = this.container;

        // helper: set value on [data-id=path] within root, record change
        const set = (path, value, root = container) => {
            const el = root.querySelector(`[data-id="${path}"]`);
            if (el) el.value = value;
            payload[path] = value;
        };

        return {
            name,
            action,
            sustained,
            psychotest,
            range,
            subtypes,
            effect,
            "weapon-range": profile.rng,
            damage: profile.dmg,
            "damage-type": profile.type,
            pen: profile.pen,
            special: profile.props,
            "rof-single": profile.rofSingle,
            "rof-short": profile.rofShort,
            "rof-long": profile.rofLong
        };
    }

    populatePsychicPower(paste) {
        const payload = this.parsePsychicPower(paste);
        applyPayload(this.container, payload);
        return payload;
    }
}
