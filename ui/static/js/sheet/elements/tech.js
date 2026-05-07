import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { Dropdown } from "../elementsLayout.js";
import { initToggleContent, initDelete, initPasteHandler, applyPayload } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
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
function parseTechPowerProfile(effect, subtypes) {
    // Initialize return values
    let rng = '', dmg = '', type = '', pen = '', props = '';
    let rofSingle = '', rofShort = '', rofLong = '';

    // —–––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
    // 1) Weapon profile
    const lines = effect.split(/\r?\n/);

    // Look for header line - support both English and Russian headers
    const hdrIdx = lines.findIndex(l => /\b(Rng|Dmg|Pen|Свойства)\b/i.test(l)
    );

    if (hdrIdx !== -1 && lines[hdrIdx + 1]) {
        const headerLine = lines[hdrIdx].trim();
        let row = lines[hdrIdx + 1].trim();

        // Check if next line is continuation (doesn't start with capital letter)
        if (lines[hdrIdx + 2] && !/^[A-ZА-ЯЁ]/i.test(lines[hdrIdx + 2].trim())) {
            row += ' ' + lines[hdrIdx + 2].trim();
        }

        const headerTokens = headerLine.split(/\s+/);
        const hasRng = /\bRng\b/i.test(headerLine);
        const hasBl = headerTokens.includes('Bl');
        const hasRoF = headerTokens.includes('RoF');

        // Remove Bl column data if present
        if (hasBl) {
            row = row.split(/\s+/).slice(0, -1).join(' ');
        }

        // Parse based on header structure
        let m;
        if (hasRng) {
            // Format: Rng [RoF] Dmg Type Pen Properties
            const rx = hasRoF
                ? /^(\S+)\s+(?:\S+\/\S+\/\S+\s+)?(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/
                : /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/;
            m = row.match(rx);
            if (m) {
                [, rng, dmg, type, pen, props] = m;
            }
        } else {
            // Format: Dmg Type Pen Properties (no Rng column)
            m = row.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
            if (m) {
                [, dmg, type, pen, props] = m;
            }
        }

        // Handle special case where dmg is single character
        if (m && dmg.length == 1) {
            let propsContinued = '';
            if (hasRng) {
                [, rng, dmg, pen, props, propsContinued] = m;
            } else {
                [, dmg, pen, props, propsContinued] = m;
            }
            props += propsContinued;
        }

        // Handle special pen notation with parentheses (like "½I.b(Окр.▲)")
        // Only move parenthetical content if pen contains fraction/slash AND starts without space
        if (/[½\/]/.test(pen) && /^\S+\(/.test(props)) {
            const parenMatch = props.match(/^(\S+\([^)]*\))/);
            if (parenMatch) {
                pen += ' ' + parenMatch[1];
                props = props.slice(parenMatch[1].length).trim();
            }
        }
    }

    return { rng, dmg, type, pen, props, rofSingle, rofShort, rofLong };
}

export class TechPower {
    constructor(container, init, characteristicBlocks) {
        this.container = container;
        this.characteristicBlocks = characteristicBlocks;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'tech-power-item-template');

            this.init = {
                roll: rollDefaults.techPower
            };
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        initPasteHandler(this.container, 'name', (text) => {
            return this.populateTechPower(text);
        });

        this._initRollDropdown();
        initRollableDamage(this.container, () => {
            const nameInput = this.container.querySelector('[data-id="name"]');
            return nameInput?.value || 'Tech Power';
        });
    }

    _initRollDropdown() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        if (!rollContainer) return;

        const nameLabel = this.container.querySelector('.split-header .name label');
        if (!nameLabel) return;

        this.rollDropdown = new Dropdown({
            container: this.container,
            toggleSelector: '.split-header .name label',
            dropdownSelector: '[data-id="roll"]',
            shouldCloseOnOutsideClick: (e) => {
                return !this.container.contains(e.target);
            }
        });

        const rollButton = rollContainer.querySelector('[data-id="rollButton"]');
        if (rollButton) {
            rollButton.addEventListener('click', () => {
                this._handleRollClick();
                this.rollDropdown.close();
            });
        }
    }

    static attachComputeds(tabId, powerId) {
        const r = characterState.technoArcana?.tabs?.items?.[tabId]?.powers?.items?.[powerId]?.roll;
        if (!r) return;

        r.total = computed(() => {
            const base = getRollValue(r.baseSelect?.value);
            const modifier = Number(r.modifier?.value) || 0;
            const extra1 = (r.extra1?.enabled?.value ? Number(r.extra1?.value?.value) || 0 : 0);
            const extra2 = (r.extra2?.enabled?.value ? Number(r.extra2?.value?.value) || 0 : 0);

            return base + modifier + extra1 + extra2;
        });
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
    parseTechPower(paste) {
        const text = paste;

        const extract = (regex, fallback = '') => {
            const match = text.match(regex);
            return match ? match[1].trim() : fallback;
        };

        const name = extract(/^([^\/]*)/m);
        const implants = extract(/железо:\s*([\s\S]*?)\s*цена:/i);
        const price = extract(/цена:\s*([\s\S]*?)\s*действие:/i);
        const action = extract(/действие:\s*([\s\S]*?)\s*процесс:/i);
        const process = extract(/процесс:\s*(.*)$/im);
        const test = extract(/тест:\s*([\s\S]*?)\s*дальность:/i);
        const range = extract(/дальность:\s*(.*)$/im);
        const subtypes = extract(/тип:\s*(.*)$/im);
        const effect = extract(/эффект:\s*([\s\S]*)$/i);

        // works for tech powers too
        const profile = parseTechPowerProfile(effect, subtypes);

        const container = this.container;

        // helper: set value on [data-id=path] within root, record change
        const set = (path, value, root = container) => {
            const el = root.querySelector(`[data-id="${path}"]`);
            if (el) el.value = value;
            payload[path] = value;
        };

        return {
            name,
            implants,
            price,
            action,
            process,
            test,
            test,
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


    applyTechPowerPayload(payload) {
        const container = this.container;
        Object.entries(payload).forEach(([path, value]) => {
            const el = container.querySelector(`[data-id="${path}"]`);
            if (el) el.value = value;
        });
    }


    populateTechPower(paste) {
        const payload = this.parseTechPower(paste);
        applyPayload(this.container, payload);
        return payload;
    }
}
