import {
    stripBrackets,
} from "./utils.js";

import {
    initDelete,
    initToggleContent,
    initPasteHandler,
    applyPayload
} from "./elementsUtils.js";

import {
    calculateBonusSuccesses,
    calculateSkillAdvancement,
    calculateTestDifficulty
} from "./system.js"

import {
    Tabs,
    Dropdown
} from "./elementsLayout.js";

import {
    nanoidWrapper,
    initDeleteItemHandler,
    initCreateItemHandler
} from "./behaviour.js";

import {
    getRoot
} from "./utils.js"

import { updateSignalAtPath } from "./state/sync.js";

import { characterState } from "./state/state.js";

import { Autocomplete } from "./autocomplete.js";

import { getDataPath } from "./utils.js";

import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";

/**
 * Clones a template and extracts its inner content (excluding the outer wrapper)
 * @param {string} templateId - ID of the template element
 * @returns {DocumentFragment} - Fragment containing the template's children
 */
function cloneTemplateContent(templateId) {
    const template = document.getElementById(templateId);
    if (!template) {
        console.error(`Template not found: ${templateId}`);
        return document.createDocumentFragment();
    }

    const clone = template.content.cloneNode(true);

    // Find the outer wrapper element (first child that's an Element)
    const wrapper = clone.querySelector('*');
    if (!wrapper) {
        console.error(`No wrapper element found in template: ${templateId}`);
        return clone;
    }

    // Create a fragment with just the inner content
    const fragment = document.createDocumentFragment();
    while (wrapper.firstChild) {
        fragment.appendChild(wrapper.firstChild);
    }

    return fragment;
}

/**
 * Replaces all occurrences of placeholder IDs in a DOM fragment
 * @param {DocumentFragment|Element} fragment - The DOM fragment to process
 * @param {string} itemId - The actual item ID to use
 * @param {string} [placeholderId] - Optional placeholder ID (for melee tab IDs, etc.)
 */
function replaceTemplateIds(fragment, itemId, placeholderId = null) {
    const elements = fragment.querySelectorAll ?
        fragment.querySelectorAll('*') :
        Array.from(fragment.children).flatMap(el => [el, ...el.querySelectorAll('*')]);

    elements.forEach(el => {
        // Replace TEMPLATE_ID with itemId
        if (el.hasAttribute('name')) {
            const name = el.getAttribute('name');
            el.setAttribute('name', name.replace('TEMPLATE_ID', itemId));
        }

        if (el.hasAttribute('for')) {
            const forAttr = el.getAttribute('for');
            el.setAttribute('for', forAttr.replace('TEMPLATE_ID', itemId));
        }

        if (el.hasAttribute('id')) {
            const id = el.getAttribute('id');
            el.setAttribute('id', id.replace('TEMPLATE_ID', itemId));
        }

        if (el.hasAttribute('data-id')) {
            const dataId = el.getAttribute('data-id');
            el.setAttribute('data-id', dataId.replace('TEMPLATE_ID', itemId));
        }

        // Replace PLACEHOLDER_ID with placeholderId (for melee tabs, etc.)
        if (placeholderId) {
            if (el.hasAttribute('name')) {
                const name = el.getAttribute('name');
                el.setAttribute('name', name.replace('PLACEHOLDER_ID', placeholderId));
            }

            if (el.hasAttribute('for')) {
                const forAttr = el.getAttribute('for');
                el.setAttribute('for', forAttr.replace('PLACEHOLDER_ID', placeholderId));
            }

            if (el.hasAttribute('id')) {
                const id = el.getAttribute('id');
                el.setAttribute('id', id.replace('PLACEHOLDER_ID', placeholderId));
            }

            if (el.hasAttribute('data-id')) {
                const dataId = el.getAttribute('data-id');
                el.setAttribute('data-id', dataId.replace('PLACEHOLDER_ID', placeholderId));
            }
        }
    });
}

/**
 * Creates an item from a template
 * Template already has default values pre-rendered, so we just clone and replace IDs
 * @param {Element} container - The container element (already created by elementsLayout.js)
 * @param {string} templateId - ID of the template to use
 * @param {string} [placeholderId] - Optional placeholder ID for nested elements (melee tabs)
 */
function createItemFromTemplate(container, templateId, placeholderId = null) {
    const itemId = container.dataset.id;

    const content = cloneTemplateContent(templateId);
    replaceTemplateIds(content, itemId, placeholderId);
    container.appendChild(content);
}

/**
 * Generic function to get roll defaults from a script element
 * @param {string} scriptId - The ID of the script element
 * @returns {object} Parsed JSON object, or {} if not found
 */
function getRollDefaultContent(scriptId) {
    const script = document.getElementById(scriptId);
    if (script) {
        return JSON.parse(script.textContent);
    } else {
        console.error(`Roll defaults script not found: ${scriptId}`);
        return {};
    }
}

// Exported reference - starts null, gets populated on sheet load
export let rollDefaults = null;

/**
 * Initialize roll defaults from DOM. Call once after charactersheet_inserted event.
 */
export function initializeRollDefaults() {
    rollDefaults = Object.freeze({
        rangedAttack: Object.freeze(getRollDefaultContent('attack-default-roll-content-ranged')),
        meleeAttack: Object.freeze(getRollDefaultContent('attack-default-roll-content-melee')),
        psychicPower: Object.freeze(getRollDefaultContent('psychotest-default-roll-content')),
        techPower: Object.freeze(getRollDefaultContent('tech-power-default-roll-content')),
    });
}

/**
 * Used inside computed(() => ...) for reactive totals.
 * @param {string} baseSelectValue - The value of the baseSelect input
 * @returns {number}
 */
function getRollValue(baseSelectValue) {
    if (!baseSelectValue) return 0;

    const overrideMatch = baseSelectValue.match(/^(.+?)\s*\(([A-Za-z]+)\)$/);
    const lookupName = overrideMatch ? overrideMatch[1].trim() : baseSelectValue;
    const overrideChar = overrideMatch ? overrideMatch[2] : null;

    // Plain characteristic (no override)
    if (!overrideChar) {
        const charKeys = ["WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Inf", "Cor"];
        if (charKeys.includes(baseSelectValue)) {
            return characterState.characteristics[baseSelectValue]?.calculatedValue?.value ?? 0;
        }
    }

    const resolveSkill = (skill) => {
        if (!overrideChar) return skill.difficulty?.value ?? 0;
        const charVal = characterState.characteristics?.[overrideChar]
            ?.calculatedValue?.value ?? 0;
        let count = 0;
        if (skill.plus0?.value) count++;
        if (skill.plus10?.value) count++;
        if (skill.plus20?.value) count++;
        if (skill.plus30?.value) count++;
        return calculateTestDifficulty(charVal, calculateSkillAdvancement(count))
            + (Number(skill.miscBonus?.value) || 0);
    };

    const normalized = lookupName.toLowerCase().replace(/\s+/g, '-');

    for (const [id, skill] of Object.entries(characterState.skillsLeft ?? {})) {
        if (id === normalized) return resolveSkill(skill);
    }
    for (const [id, skill] of Object.entries(characterState.skillsRight ?? {})) {
        if (id === normalized) return resolveSkill(skill);
    }
    for (const skill of Object.values(characterState.customSkills?.items ?? {})) {
        if (skill.name?.value?.toLowerCase() === lookupName.toLowerCase()) {
            return resolveSkill(skill);
        }
    }

    return 0;
}

/**
 * Used in _handleRollClick for roll events.
 * Reads the select element and returns both the base value and bonus successes.
 * @param {Element} rollContainer
 * @returns {{baseValue: number, bonusSuccesses: number}}
 */
function getRollFull(rollContainer) {
    const sel = rollContainer.querySelector('select[data-id="baseSelect"]');
    if (!sel) return { baseValue: 0, bonusSuccesses: 0 };

    const selectedOption = sel.options[sel.selectedIndex];
    const type = selectedOption?.dataset?.type;
    const key = sel.value;

    if (type === 'characteristic') {
        const char = characterState.characteristics?.[key];
        const value = char?.calculatedValue?.value ?? 0;
        const unnatural = char?.calculatedUnnatural?.value ?? 0;
        return {
            baseValue: value,
            bonusSuccesses: calculateBonusSuccesses(unnatural)
        };
    }

    if (type === 'skill') {
        const baseValue = getRollValue(key);

        // Bonus successes from the governing characteristic
        const overrideMatch = key.match(/^(.+?)\s*\(([A-Za-z]+)\)$/);
        let charKey = overrideMatch ? overrideMatch[2] : null;

        if (!charKey) {
            const normalized = key.toLowerCase().replace(/\s+/g, '-');
            const allSkills = {
                ...characterState.skillsLeft,
                ...characterState.skillsRight,
                ...Object.fromEntries(
                    Object.values(characterState.customSkills?.items ?? {})
                        .map(s => [s.name?.value?.toLowerCase(), s])
                )
            };
            const skill = allSkills[normalized];
            charKey = skill?.characteristic?.value ?? null;
        }

        const unnatural = charKey
            ? (characterState.characteristics?.[charKey]?.calculatedUnnatural?.value ?? 0)
            : 0;

        return {
            baseValue,
            bonusSuccesses: calculateBonusSuccesses(unnatural)
        };
    }

    return { baseValue: 0, bonusSuccesses: 0 };
}

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


function getSkillName(value) {
    const match = value.match(/^(.+?)(?:\s*\([A-Z]+\))?$/);
    return match ? match[1].trim() : value;
};

function getCharFromSkillValue(value) {
    const match = value.match(/\(([A-Z]+)\)$/);
    return match ? match[1] : null;
};

/**
 * Initialize rollable damage label
 * @param {Element} container - Container element with damage field
 * @param {string} sourceName - Name of the source (weapon/power name)
 */
function initRollableDamage(container, sourceName) {
    const damageRow = container.querySelector('.layout-row.damage');
    if (!damageRow) return;

    const label = damageRow.querySelector('label');
    const input = damageRow.querySelector('input[data-id="damage"]');

    if (!label || !input) return;

    // Make label clickable
    label.classList.add('rollable');
    label.addEventListener('click', () => {
        const diceExpression = input.value.trim();
        if (!diceExpression) return;

        // Dispatch simple dice roll event
        document.dispatchEvent(new CustomEvent('sheet:rollExact', {
            bubbles: true,
            detail: {
                expression: diceExpression,
                label: sourceName()
            }
        }));
    });
}

export class RangedAttack {
    constructor(container, init, characteristicBlocks) {
        this.container = container;
        this.characteristicBlocks = characteristicBlocks;
        this.ID = container.dataset.id

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'ranged-attack-item-template');
            this.init = {
                roll: rollDefaults.rangedAttack
            };
        }

        this.descEl = this.container.querySelector('[data-id="description"]');
        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });

        initDelete(this.container, ".delete-button");
        initPasteHandler(this.container, 'name', (text) => {
            return this.populateRangedAttack(text);
        });

        this._initRollDropdown();

        initRollableDamage(this.container, () => {
            const nameInput = this.container.querySelector('[data-id="name"]');
            return nameInput?.value || 'Ranged Attack';
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

        // Setup roll button
        const rollButton = rollContainer.querySelector('[data-id="rollButton"]');
        if (rollButton) {
            rollButton.addEventListener('click', () => {
                this._handleRollClick();
                this.rollDropdown.close();
            });
        }
    }

    static attachComputeds(attackId) {
        const r = characterState.rangedAttacks?.list?.items?.[attackId]?.roll;
        if (!r) return;

        r.total = computed(() => {
            const base = getRollValue(r.baseSelect?.value);

            const aimSel = r.aim?.selected?.value ?? "no";
            const aim = aimSel === "half" ? (Number(r.aim?.half?.value) || 0)
                : aimSel === "full" ? (Number(r.aim?.full?.value) || 0)
                    : (Number(r.aim?.no?.value) || 0);

            const tSel = r.target?.selected?.value ?? "no";
            const targetMap = {
                torso: "torso", leg: "leg", arm: "arm",
                head: "head", joint: "joint", eyes: "eyes"
            };
            const tKey = targetMap[tSel];
            const target = tKey ? (Number(r.target?.[tKey]?.value) || 0)
                : (Number(r.target?.no?.value) || 0);

            const rSel = r.range?.selected?.value ?? "combat";
            const rangeMap = {
                melee: "melee", pointBlank: "pointBlank", short: "short",
                combat: "combat", long: "long", extreme: "extreme"
            };
            const range = Number(r.range?.[rangeMap[rSel] ?? "combat"]?.value) || 0;

            const rofSel = r.rof?.selected?.value ?? "single";
            const rofMap = {
                single: "single", short: "short", long: "long", suppression: "suppression"
            };
            const rof = Number(r.rof?.[rofMap[rofSel] ?? "single"]?.value) || 0;

            const extra1 = (r.extra1?.enabled?.value ? Number(r.extra1?.value?.value) || 0 : 0);
            const extra2 = (r.extra2?.enabled?.value ? Number(r.extra2?.value?.value) || 0 : 0);

            return base + aim + target + range + rof + extra1 + extra2;
        });
    }


    _handleRollClick() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        const totalInput = rollContainer.querySelector('[data-id="total"]');
        const target = parseInt(totalInput.value, 10) || 0;

        // Get bonus successes
        const { bonusSuccesses } = getRollFull(rollContainer, this.characteristicBlocks);

        // Build label
        const label = this._buildRollLabel(rollContainer);

        // Emit roll event
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
        const weaponName = this.container.querySelector('[data-id="name"]')?.value || 'Unknown';
        const modifiers = [];

        // Helper to get friendly name
        const getFriendlyName = (column, value) => {
            const friendlyNames = {
                aim: { half: 'half aim', full: 'full aim' },
                target: {
                    torso: 'torso', leg: 'leg', arm: 'arm',
                    head: 'head', joint: 'joint', eyes: 'eyes'
                },
                range: {
                    melee: 'melee', 'point-blank': 'point-blank',
                    short: 'short', long: 'long', extreme: 'extreme'
                },
                rof: {
                    single: 'single shot', short: 'short burst',
                    long: 'long burst', suppression: 'suppression'
                }
            };
            return friendlyNames[column]?.[value] || value;
        };

        // Default values to exclude
        const defaults = {
            aim: 'no',
            target: 'no',
            range: 'combat',
            rof: 'single'
        };

        // Check each column
        ['aim', 'target', 'range', 'rof'].forEach(columnId => {
            const column = rollContainer.querySelector(`[data-id="${columnId}"]`);
            if (!column) return;

            const selectedRadio = column.querySelector('input[type="radio"]:checked');
            if (!selectedRadio || selectedRadio.value === defaults[columnId]) return;

            modifiers.push(getFriendlyName(columnId, selectedRadio.value));
        });

        // Add extra modifiers if enabled
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
            ? `${weaponName}, ${modifiers.join(', ')}`
            : weaponName;
    }

    // Populate field values from pasted string
    parseRangedAttack(paste) {
        // Some rows have alt profiles in [], like Legion version
        const curedPaste = paste.replace(/\r?\n?\[.*?\]/g, '');
        const lines = curedPaste
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean);

        // 1) Name = lines[0] + lines[1] + lines[2]
        // const name = lines.slice(0, 3).join(" ");
        const name = lines[0];

        // --- CLASS mapping Russian → option value
        const classMap = {
            "пистолет": "pistol",
            "винтовка": "rifle",
            "длинная винтовка": "long rifle",
            "дл. винтовка": "long rifle",
            "тяжелое": "heavy",
            "метательное": "throwing",
            "граната": "grenade",
            "особое": "special",
        };

        // 2) Everything else is on line 4 and further
        //    CLASS  RANGE   RoF     DMG       TYPE  PEN   CLIP-CUR  CLIP-MAX  RLD   [special…]
        // e.g. ["пистолет","15м","S/–/–","1d10+2","I","0","1","3", "Primitive,","…"]
        // Use only the first line for class parsing
        const fullStatLine = lines.slice(3).join(" ");
        // Try to find matching class prefix from the map
        const rawClassKey = Object.keys(classMap).find(key =>
            fullStatLine.toLowerCase().startsWith(key)
        );
        if (!rawClassKey) {
            throw new Error("Unknown weapon class prefix in: " + fullStatLine);
        }
        const clsValue = classMap[rawClassKey.toLowerCase()] || rawClass;

        // Remove the class part from the line
        const withoutClass = fullStatLine.slice(rawClassKey.length).trim();

        // Continue parsing the rest
        const parts = withoutClass.split(/\s+/);
        let i = 0;

        // parts[0]=range, [1]=RoF
        const range = parts[i++];
        const rofAll = parts[i++];
        const rofSingle = rofAll.split('/')[0];
        const rofShort = rofAll.split('/')[1];
        const rofLong = rofAll.split('/')[2];

        // 3) Damage
        const damage = parts[i++];

        // 4) Damage-type: only consume if it’s a known letter
        let damageType;
        const reDamage = /^(?:(?:\d+|X|N)?d(?:10|5)(?:[+-][A-Za-z0-9.]+)?|\d+)$/;
        if (reDamage.test(damage)) {
            damageType = parts[i++];
        }

        // 5) Pen
        const pen = parts[i++];

        // 6) Clip-max
        const clipMax = parts[i++];

        // 7) Reload (may be omitted)
        let reload = parts[i++];

        // 8) Special / weight / recoil
        //    find the weight token (contains “кг” or “kg”)
        const rest = parts.slice(i);

        // --- Special traits: everything before weight & rarity
        const traits = rest
            .slice(0, rest.length - 2)
            .join(" ")
            .replace(/,\s*/g, ", ")
            .trim()
            .replace(/,\s*$/, '');

        // build and return payload
        return {
            name,
            class: clsValue,
            range,
            "rof-single": rofSingle,
            "rof-short": rofShort,
            "rof-long": rofLong,
            damage,
            "damage-type": damageType || "",
            pen,
            "clip-cur": clipMax,
            "clip-max": clipMax,
            reload,
            special: traits
        };
    }

    populateRangedAttack(paste) {
        const payload = this.parseRangedAttack(paste);
        applyPayload(this.container, payload);
        return payload;
    }
}

const PROFILE_MAP = {
    'булава': 'mace',
    'глефа': 'glaive',
    'кистень': 'flail',
    'кнут': 'whip',
    'когти': 'claws',
    'когти.р': 'claws.h',
    'когти.п': 'claws.a',
    'копье': 'spear',
    'крюк': 'hook',
    'кулак': 'fist',
    'кулак.б': 'fist.a',
    'меч': 'sword',
    'рапира': 'rapier',
    'сабля': 'saber',
    'молот': 'hammer',
    'нож': 'knife',
    'посох': 'staff',
    'топор': 'axe',
    'штык': 'bayonet',
    'щит': 'shield',
    'укус': 'bite',
    'нет': 'no'
};


function tokenize(text) {
    // 1) break into comma-chunks
    const commaChunks = text.split(', ');
    const tokens = [];

    commaChunks.forEach((chunk, idx) => {
        // 2) split on spaces not before '('
        //     so we keep "word (bracket)" together
        const pieces = chunk.split(/ (?!\()/);

        // 3) re-attach comma to the last piece, if this isn't the final chunk
        if (idx < commaChunks.length - 1) {
            pieces[pieces.length - 1] += ',';
        }

        tokens.push(...pieces);
    });

    return tokens;
}


function findGroup(tokens) {
    const re = /\b(primary|chain|shock|power|ex(?:otic)?)\b/i;
    let groupIndex = -1;
    let temp;
    for (let i = 0; i < tokens.length; i++) {
        const match = tokens[i].match(re);
        if (match) {
            groupIndex = i;
            temp = match[1].toLowerCase();
            break;
        }
    }
    const group = temp.startsWith('ex') ? 'exotic' : temp;
    return [group, groupIndex];
}


function findProfiles(tokens, profiles) {
    const profileRegex = new RegExp(`(?:${profiles.join('|')})`, 'i');
    let profileCount = 0;
    let firstProfileIndex = -1;
    tokens.forEach((token, idx) => {
        if (profileRegex.test(token)) {
            profileCount++;
            if (firstProfileIndex === -1) {
                firstProfileIndex = idx;
            }
        }
    });
    return [profileCount, firstProfileIndex];
}


function mergeStringsOnCommas(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
        let cur = arr[i];
        while (cur.endsWith(',') && i + 1 < arr.length) {
            cur += ' ' + arr[++i];
        }
        if (cur !== '') out.push(cur);
    }
    return out;
}


export class MeleeAttack {
    constructor(container, init, characteristicBlocks) {
        this.container = container;
        this.characteristicBlocks = characteristicBlocks;
        this.ID = container.dataset.id;
        this.IDNumber = this.ID.substring(this.ID.lastIndexOf("-") + 1)

        if (container.children.length === 0) {
            // Generate tab ID before creating template
            let firstTabID;
            if (init?.[0] != null) {
                firstTabID = init[0].split(".")[1];
            } else {
                firstTabID = "tab-" + nanoidWrapper();
            }

            createItemFromTemplate(container, 'melee-attack-item-template', firstTabID);

            this.init = {
                tabs: {
                    items: {
                        [firstTabID]: {}
                    },
                    layouts: {
                        [firstTabID]: { colIndex: 0, rowIndex: 0 }
                    }
                },
                roll: rollDefaults.meleeAttack
            };
        }

        this.descEl = this.container.querySelector('[data-id="description"]');
        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        initDelete(this.container, ".delete-button");

        initPasteHandler(this.container, 'name', (text) => {
            return this.populateMeleeAttack(text);
        });

        const settings = [
            tabs => initCreateItemHandler(tabs),
            tabs => initDeleteItemHandler(tabs),
        ]

        this.tabs = new Tabs(
            this.container.querySelector(".tabs"),
            this.container.dataset.id,
            settings,
            {
                addBtnText: '+',
                tabContent: this.getTabContentTemplate(),
                tabLabel: this.getTabLabelTemplate()
            });

        this._initRollDropdown();
        this._initDamageRolls();
    }

    _initDamageRolls() {
        // Initialize for existing tabs
        this._setupDamageForExistingTabs();

        // Listen for new tabs being created (event-based, no observer needed)
        this.tabs.container.addEventListener('createItemLocal', (e) => {
            // Wait for DOM to update, then setup damage for the new tab
            requestAnimationFrame(() => {
                const tabId = e.detail.itemId;
                const panel = this.tabs.container.querySelector(`.panel[data-id="${tabId}"]`);
                if (panel) {
                    const tab = panel.querySelector('.profile-tab');
                    if (tab) {
                        this._setupDamageForTab(tab);
                    }
                }
            });
        });
    }

    _setupDamageForExistingTabs() {
        const tabs = this.tabs.container.querySelectorAll('.profile-tab');
        tabs.forEach(tab => this._setupDamageForTab(tab));
    }

    _setupDamageForTab(tab) {
        initRollableDamage(tab, () => {
            const weaponName = this.container.querySelector('[data-id="name"]')?.value || 'Melee Attack';

            // Get the profile from the tab label
            const panel = tab.closest('.panel');
            if (panel) {
                const tabId = panel.dataset.id;
                const label = this.tabs.container.querySelector(`label.tablabel[data-id="${tabId}"]`);
                if (label) {
                    const profileSelect = label.querySelector('select[data-id="profile"]');
                    const profile = profileSelect?.value || '';
                    if (profile && profile !== 'no') {
                        return `${weaponName}, ${profile}`;
                    }
                }
            }

            return weaponName;
        });
    }

    /**
     * Get tab label HTML from server-rendered template
     * @returns {string} HTML for tab label (profile select + buttons)
     */
    getTabLabelTemplate() {
        const template = document.getElementById('melee-tab-label-template');
        if (!template) {
            console.error('melee-tab-label-template not found');
            return '';
        }

        // Clone and get inner HTML
        const clone = template.content.cloneNode(true);
        const wrapper = document.createElement('div');
        wrapper.appendChild(clone);

        // Add drag handle and delete button
        return wrapper.innerHTML + `
            <div class="drag-handle"></div>
            <button class="delete-button"></button>
        `;
    }

    /**
     * Get tab content HTML from server-rendered template
     * @returns {string} HTML for tab content (profile fields)
     */
    getTabContentTemplate() {
        const template = document.getElementById('melee-tab-content-template');
        if (!template) {
            console.error('melee-tab-content-template not found');
            return '';
        }

        // Clone and get inner HTML
        const clone = template.content.cloneNode(true);
        const wrapper = document.createElement('div');
        wrapper.appendChild(clone);

        return wrapper.innerHTML;
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

        // Setup roll button
        const rollButton = rollContainer.querySelector('[data-id="rollButton"]');
        if (rollButton) {
            rollButton.addEventListener('click', () => {
                this._handleRollClick();
                this.rollDropdown.close();
            });
        }
    }

    static attachComputeds(attackId) {
        const r = characterState.meleeAttacks?.list?.items?.[attackId]?.roll;
        if (!r) return;

        r.total = computed(() => {
            const base = getRollValue(r.baseSelect?.value);

            const aimSel = r.aim?.selected?.value ?? "no";
            const aim = aimSel === "half" ? (Number(r.aim?.half?.value) || 0)
                : aimSel === "full" ? (Number(r.aim?.full?.value) || 0)
                    : (Number(r.aim?.no?.value) || 0);

            const tSel = r.target?.selected?.value ?? "no";
            const targetMap = {
                torso: "torso", leg: "leg", arm: "arm",
                head: "head", joint: "joint", eyes: "eyes"
            };
            const tKey = targetMap[tSel];
            const target = tKey ? (Number(r.target?.[tKey]?.value) || 0)
                : (Number(r.target?.no?.value) || 0);

            const bSel = r.base?.selected?.value ?? "standard";
            const baseMap = {
                standard: "standard", charge: "charge", full: "full",
                careful: "careful", mounted: "mounted", free: "free"
            };
            const baseVal = Number(r.base?.[baseMap[bSel] ?? "standard"]?.value) || 0;

            const stSel = r.stance?.selected?.value ?? "standard";
            const stanceMap = { standard: "standard", aggressive: "aggressive", defensive: "defensive" };
            const stance = Number(r.stance?.[stanceMap[stSel] ?? "standard"]?.value) || 0;

            const rofSel = r.rof?.selected?.value ?? "single";
            const rofMap = { single: "single", quick: "quick", lightning: "lightning" };
            const rof = Number(r.rof?.[rofMap[rofSel] ?? "single"]?.value) || 0;

            const extra1 = (r.extra1?.enabled?.value ? Number(r.extra1?.value?.value) || 0 : 0);
            const extra2 = (r.extra2?.enabled?.value ? Number(r.extra2?.value?.value) || 0 : 0);

            return base + aim + target + baseVal + stance + rof + extra1 + extra2;
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
        const weaponName = this.container.querySelector('[data-id="name"]')?.value || 'Unknown';
        const modifiers = [];

        const getFriendlyName = (column, value) => {
            const friendlyNames = {
                aim: { half: 'half aim', full: 'full aim' },
                target: {
                    torso: 'torso', leg: 'leg', arm: 'arm',
                    head: 'head', joint: 'joint', eyes: 'eyes'
                },
                base: {
                    charge: 'charge', full: 'full attack',
                    careful: 'careful', mounted: 'mounted'
                },
                stance: { aggressive: 'aggressive', defensive: 'defensive' },
                rof: {
                    single: 'single attack', quick: 'quick attack',
                    lightning: 'lightning attack'
                }
            };
            return friendlyNames[column]?.[value] || value;
        };

        const defaults = {
            aim: 'no',
            target: 'no',
            base: 'standard',
            stance: 'standard',
            rof: 'single'
        };

        ['aim', 'target', 'base', 'stance', 'rof'].forEach(columnId => {
            const column = rollContainer.querySelector(`[data-id="${columnId}"]`);
            if (!column) return;

            const selectedRadio = column.querySelector('input[type="radio"]:checked');
            if (!selectedRadio || selectedRadio.value === defaults[columnId]) return;

            modifiers.push(getFriendlyName(columnId, selectedRadio.value));
        });

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
            ? `${weaponName}, ${modifiers.join(', ')}`
            : weaponName;
    }

    /**
     * Populate field values from pasted string,
     * creating one tab per profile and wiping out any existing tabs.
     */
    parseMeleeAttack(paste) {
        const container = this.container;
        const tabs = this.tabs;
        const payload = { tabs: [] };

        // helper: set value on [data-id=path] within root, record change
        const set = (path, value, root = container, tabIndex = null) => {
            const el = root.querySelector(`[data-id="${path}"]`);
            if (el) el.value = value;
            if (tabIndex === null) {
                payload[path] = value;
            } else {
                if (!payload.tabs[tabIndex]) payload.tabs[tabIndex] = {};
                payload.tabs[tabIndex][path] = value;
            }
        };

        // 1) Extract name
        const [namePart, restPart] = paste.split(/\/(.+)/s); // Split on first `/`
        const name = namePart.trim();

        const rest = restPart
            .trim()
            .replace(/(баклер|тарг|экю|круглый|каплевидный|л\. башенный|башенный|любой)/gi, 'щит')
            .replace(/\n/g, ' ') || '';

        // 2) Split rest of the string into tokens and find group
        let tokens = tokenize(rest);
        const [group, groupIndex] = findGroup(tokens);

        // 3) Count profiles and find first; everything before group can be discarded
        tokens = tokens.slice(groupIndex + 1);
        const WEAPON_PROFILES = [
            'булава', 'глефа', 'кистень', 'кнут', 'когти\\.Р', 'когти\\.П', 'когти',
            'копье', 'крюк', 'кулак\\.Б', 'кулак', 'меч', 'рапира', 'сабля', 'молот',
            'нож', 'посох', 'топор', 'штык', 'щит', 'укус', 'нет', '(?<=^|\\s)–(?=$|\\s)'
        ];
        const [profileCount, firstProfileIndex] = findProfiles(tokens, WEAPON_PROFILES);

        // 4) Grip is between group and profiles
        const grip = tokens.slice(0, firstProfileIndex).join(' ');

        // 5) Balance is third from the end 
        let balance;
        if (tokens[firstProfileIndex].toLowerCase() === 'щит') {
            balance = '0';
            tokens = tokens.slice(0, tokens.length - 2);
        } else {
            balance = tokens[tokens.length - 3];
            tokens = tokens.slice(0, tokens.length - 3);
        }

        // it's impossible to discern starts and ends of special
        // after splitting tokens on whitespace
        // dirty hack around, following quirks of entries in rulebook
        let specialProfiles;
        if (profileCount > 1) {
            specialProfiles = paste.split('\n');
            // remove balance, weight, rarity
            if (profileCount > 2) {
                specialProfiles.splice(-1);
            } else {
                const t = specialProfiles[specialProfiles.length - 1]
                    .split(" ")
                    .slice(0, -3)
                    .join(" ");
                specialProfiles[specialProfiles.length - 1] = t;
            }
            // find index of pen
            let lastPen = specialProfiles.findLastIndex((l) => /^\[?\d+\]?$/.test(l));
            specialProfiles = specialProfiles.splice(lastPen + 1);
            specialProfiles = mergeStringsOnCommas(specialProfiles);
        }

        const parsedTabs = [];
        const start = firstProfileIndex;
        for (let i = 0; i < profileCount; i++) {
            const profileName = stripBrackets(tokens[start + i]);
            const range = stripBrackets(tokens[start + i + profileCount]);
            const damage = stripBrackets(tokens[start + 2 * i + 2 * profileCount]);
            const damageType = stripBrackets(tokens[start + 2 * i + 1 + 2 * profileCount]);
            const pen = stripBrackets(tokens[start + i + 4 * profileCount] || '');

            let special;
            if (profileCount === 1) {
                special = stripBrackets(tokens.slice(start + 2 * i + 5 * profileCount).join(' '));
            } else {
                special = stripBrackets(specialProfiles[i] || '');
            }

            parsedTabs.push({
                profile: PROFILE_MAP[profileName.toLowerCase()] || 'no',
                range,
                damage,
                damageType,
                pen,
                special
            });
        }

        return {
            name,
            group,
            grip,
            balance,
            tabs: { items: parsedTabs },
        };
    }

    applyMeleePayload(payload) {
        // clear old tabs
        this.tabs.clearTabs();

        // we’re going to build a new object instead of an array
        const tabsById = {};

        // for each parsed tab entry, create a real tab
        payload.tabs.items.forEach(tabData => {
            const { label, panel } = this.tabs._createNewItem();

            // assume your <panel> has something like data-id="meleeAttack-1__tab-XYZ"
            const tabId = panel.getAttribute('data-id') || panel.id;
            tabsById[tabId] = {};

            // fill both DOM and our tabsById[tabId]
            Object.entries(tabData).forEach(([path, value]) => {
                // convert camelCase → kebab-case (e.g., damageType → damage-type)
                const dataId = path.replace(/([A-Z])/g, '-$1').toLowerCase();

                const root = (path === 'profile') ? label : panel;
                const el = root.querySelector(`[data-id="${dataId}"]`);
                if (el) el.value = value;
                tabsById[tabId][path] = value;
            });
        });

        // show first tab
        this.tabs.selectTab(0);

        // top-level fields
        ['name', 'group', 'grip', 'balance'].forEach(k => {
            const el = this.container.querySelector(`[data-id="${k}"]`);
            if (el && payload[k] != null) el.value = payload[k];
        });

        // overwrite payload.tabs.items with our keyed object
        payload.tabs.items = tabsById;

        return payload;
    }

    populateMeleeAttack(paste) {
        let payload = this.parseMeleeAttack(paste);
        payload = this.applyMeleePayload(payload);
        return payload;
    }
}


export class GearItem {
    constructor(container) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'gear-item-template');
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" })
        initDelete(this.container, ".delete-button");

        initPasteHandler(this.container, 'name', (text) => {
            return this.populateInventoryItem(text);
        });
    }

    parseInventoryItem(paste) {
        // 1. Split off the description (everything after the first newline)
        const [headerLine, ...restLines] = paste.split(/\r?\n/);
        const description = restLines.join("\n").trim();

        // 2. From the header line, extract the name
        //    Look for text between "|" and "W:"
        //    /\|\s*(.*?)\s*W:/ 
        const nameMatch = headerLine.match(/\|\s*(.*?)\s*W:/);
        const name = nameMatch ? nameMatch[1] : "";

        // 3. Extract the raw weight string (e.g. "1кг", "2.5 kg")
        const weightMatch = headerLine.match(/W:(.+)$/);
        const raw = weightMatch ? weightMatch[1].trim() : "";

        // 4. Strip to just the number (digits and optional decimal point)
        const numMatch = raw.match(/[\d.]+/);
        const weight = parseFloat(numMatch ? numMatch[0] : "0");

        return { name, weight, description };
    }

    populateInventoryItem(paste) {
        const payload = this.parseInventoryItem(paste);
        applyPayload(this.container, payload);
        return payload;
    }
}



// Advancement types that derive cost from aptitudes + character state.
// All others use the stored experienceCost directly.
const CALC_TYPES = new Set(['characteristic', 'skill', 'talent']);

export class ExperienceItem {
    constructor(container, { socket }) {
        this.container = container;
        this._socket = socket;
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
            this._autocomplete = new Autocomplete({
                input: nameInput,
                socket: this._socket,
                buildQuery: query => ({
                    type: 'autocomplete',
                    collection: 'advancements',
                    query,
                }),
                renderOption: r => this._renderOption(r),
                onSelect: r => {
                    // Dispatch input for signal sync and UI updates, but flag
                    // it so the delegated handler in network.js skips the send.
                    nameInput.value = r.name;
                    const ev = new Event('input', { bubbles: true });
                    ev._noSync = true;
                    nameInput.dispatchEvent(ev);

                    // All fields (including name) arrive via the batch the
                    // server broadcasts to all clients including this one.
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
                },
            });
        }
    }

    // ── Field visibility ───────────────────────────────────────────────────

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

    // ── Autocomplete rendering ─────────────────────────────────────────────

    _renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        const type = r.type ? `<span class="ac-type">${r.type}</span>` : '';
        const cost = r.experienceCost ? `<span class="ac-cost">${r.experienceCost} xp</span>` : '';

        let meta = '';
        if (r.discipline) {
            meta += `<span class="ac-meta">${r.discipline}`;
            if (r.subdiscipline) meta += ` / ${r.subdiscipline}`;
            meta += `</span>`;
        }

        if (Array.isArray(r.requirements) && r.requirements.length) {
            meta += `<span class="ac-reqs">Req: ${r.requirements.join(', ')}</span>`;
        }

        return `<div class="ac-name">${name}</div><div class="ac-details">${type}${cost}${meta}</div>`;
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


export class ResourceTracker {
    constructor(container) {
        this.container = container;
        if (container.children.length === 0) {
            createItemFromTemplate(container, 'resource-tracker-item-template');
        }

        initDelete(this.container, ".delete-button");
    }
}

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
            return m[1].split('/');   // ["S","2","все"], for example
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

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" })
        initDelete(this.container, ".delete-button")

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
        applyPayload(this.container, payload)
        return payload;
    }
}


export class CustomSkill {
    constructor(container) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'custom-skill-item-template');
        }

        this.selectEl = this.container.querySelector("select");
        this.checkboxEls = Array.from(
            this.container.querySelectorAll('input[type="checkbox"]')
        );
        this.difficultyInput = this.container.querySelector('input[data-id="difficulty"]');

        // interactivity is added to both skills and custom skills in initSkillsTable() in script.js
        initDelete(this.container, ".delete-button");
    }

    static attachComputeds(skillId) {
        const sk = characterState.customSkills?.list?.items?.[skillId];
        if (!sk) return;

        sk.difficulty = computed(() => {
            const charKey = sk.characteristic?.value || "WS";
            const c = characterState.characteristics?.[charKey];
            const charVal = (parseInt(c?.value?.value, 10) || 0)
                + ((c?.tempEnabled?.value ?? false) ? (parseInt(c?.tempValue?.value, 10) || 0) : 0);

            let count = 0;
            if (sk.plus0?.value) count++;
            if (sk.plus10?.value) count++;
            if (sk.plus20?.value) count++;
            if (sk.plus30?.value) count++;

            return calculateTestDifficulty(charVal, calculateSkillAdvancement(count))
                + (Number(sk.miscBonus?.value) || 0);
        });
    }
}

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
    const hdrIdx = lines.findIndex(l =>
        /\b(Rng|Dmg|Pen|Свойства)\b/i.test(l)
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

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" })
        initDelete(this.container, ".delete-button")

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
        applyPayload(this.container, payload)
        return payload;
    }
}

export class ArmourPart {
    constructor(container) {
        this.container = container;

        // Get root for closing other dropdowns
        const root = container.getRootNode();

        // Initialize dropdown
        this.dropdown = new Dropdown({
            container: this.container,
            toggleSelector: '.armour-extra-toggle',
            dropdownSelector: '.armour-extra-dropdown',
            onOpen: () => {
                // Close all other armour dropdowns
                this._closeOtherArmourDropdowns(root);
                // Raise this body-part above siblings
                this.container.style.zIndex = '100';
            },
            onClose: () => {
                // Reset z-index when closing
                this.container.style.zIndex = '';
            },
            shouldCloseOnOutsideClick: (e) => {
                // Close if clicking outside any body-part
                return !e.target.closest('.body-part');
            }
        });

        // Store reference to dropdown instance on container
        this.container._dropdownInstance = this.dropdown;
    }

    _closeOtherArmourDropdowns(root) {
        // Find all body parts and close their dropdowns
        const allBodyParts = root.querySelectorAll('.body-part');
        allBodyParts.forEach(bp => {
            if (bp !== this.container && bp._dropdownInstance) {
                bp._dropdownInstance.close();
            }
        });
    }
}

function initRollableRating(container) {
    const ratingRow = container.querySelector('.layout-row.name');
    if (!ratingRow) return;

    const labelEl = ratingRow.querySelector('label');
    if (!labelEl) return;

    labelEl.classList.add('rollable');
    labelEl.addEventListener('click', () => {
        const name = container.querySelector('[data-id="name"]')?.value?.trim() || '';
        const rating = container.querySelector('[data-id="rating"]')?.value?.trim() || '';
        const rollLabel = [name, rating].filter(Boolean).join(' ');

        document.dispatchEvent(new CustomEvent('sheet:rollExact', {
            bubbles: true,
            detail: { expression: 'd100', label: rollLabel }
        }));
    });
}

export class PowerShield {
    constructor(container) {
        this.container = container;

        if (container.children.length === 0) {
            createItemFromTemplate(container, 'power-shield-item-template');
        }

        // Store references to elements
        this.nameEl = this.container.querySelector('[data-id="name"]');
        this.ratingEl = this.container.querySelector('[data-id="rating"]');
        this.natureEl = this.container.querySelector('[data-id="nature"]');
        this.typeEl = this.container.querySelector('[data-id="type"]');
        this.descEl = this.container.querySelector('[data-id="description"]');

        // Wire up toggle and delete functionality
        initToggleContent(this.container, {
            toggle: ".toggle-button",
            content: ".collapsible-content"
        });
        //setInitialCollapsedState(this.container);
        initDelete(this.container, ".delete-button");

        initRollableRating(this.container);
    }

    setValue(data) {
        if (data.name !== undefined) this.nameEl.value = data.name;
        if (data.rating !== undefined) this.ratingEl.value = data.rating;
        if (data.nature !== undefined) this.natureEl.value = data.nature;
        if (data.type !== undefined) this.typeEl.value = data.type;
        if (data.description !== undefined) this.descEl.value = data.description;
    }

    getValue() {
        return {
            name: this.nameEl.value,
            rating: this.ratingEl.value,
            nature: this.natureEl.value,
            type: this.typeEl.value,
            description: this.descEl.value
        };
    }

    // populatePowerShield(paste) {
    //     // Parse pasted text
    //     // Expected format:
    //     // Line 1: Name
    //     // Line 2: Rating | Nature | Type
    //     // Rest: Description
    //     const lines = paste.split(/\r?\n/);

    //     const name = lines[0] || '';
    //     let rating = '', nature = '', type = '';
    //     let descriptionStart = 1;

    //     // Try to parse second line for stats if it exists
    //     if (lines[1]) {
    //         const statLine = lines[1].trim();
    //         const parts = statLine.split('|').map(p => p.trim());

    //         if (parts.length >= 3) {
    //             rating = parts[0];
    //             nature = parts[1].toLowerCase();
    //             type = parts[2].toLowerCase();
    //             descriptionStart = 2;
    //         }
    //     }

    //     const description = lines.slice(descriptionStart).join("\n").trim();

    //     // Apply values
    //     this.nameEl.value = name;
    //     if (rating) this.ratingEl.value = rating;
    //     if (nature && ['tech', 'arcane'].includes(nature)) {
    //         this.natureEl.value = nature;
    //     }
    //     if (type && ['dome', 'phase', 'deflector'].includes(type)) {
    //         this.typeEl.value = type;
    //     }
    //     this.descEl.value = description;

    //     return { name, rating, nature, type, description };
    // }
}

export class CharacteristicBlock {
    constructor(charKey, mainBlock, permBlock, tempBlock) {
        this.charKey = charKey;
        this.mainBlock = mainBlock;
        this.permBlock = permBlock;
        this.tempBlock = tempBlock;

        // Main display (calculated, readonly)
        this.calcValue = mainBlock.querySelector('[data-id="calculatedValue"]');
        this.calcUnnatural = mainBlock.querySelector('[data-id="calculatedUnnatural"]');

        // Permanent inputs - use "value" and "unnatural" not "perm-"
        this.permValue = permBlock.querySelector('[data-id="value"]');
        this.permUnnatural = permBlock.querySelector('[data-id="unnatural"]');

        // Temporary inputs
        this.tempEnabled = tempBlock.querySelector('[data-id="tempEnabled"]');
        this.tempValue = tempBlock.querySelector('[data-id="tempValue"]');
        this.tempUnnatural = tempBlock.querySelector('[data-id="tempUnnatural"]');

        this._setupUIHandlers();
    }

    _setupUIHandlers() {
        // Click on main display to focus permanent value
        this.calcValue?.addEventListener('click', () => {
            const dropdown = getRoot().querySelector('.characteristics-dropdown');
            if (dropdown && dropdown.classList.contains('visible')) {
                this.permValue?.focus();
            }
        });

        this.calcUnnatural?.addEventListener('click', () => {
            const dropdown = getRoot().querySelector('.characteristics-dropdown');
            if (dropdown && dropdown.classList.contains('visible')) {
                this.permUnnatural?.focus();
            }
        });
    }

    static attachComputeds(key) {
        const char = characterState.characteristics?.[key];
        if (!char) return;

        char.calculatedValue = computed(() => {
            const base = parseInt(char.value?.value, 10) || 0;
            const tmpVal = parseInt(char.tempValue?.value, 10) || 0;
            const enabled = char.tempEnabled?.value ?? false;
            return base + (enabled ? tmpVal : 0);
        });

        char.calculatedUnnatural = computed(() => {
            const base = parseInt(char.unnatural?.value, 10) || 0;
            const tmpUn = parseInt(char.tempUnnatural?.value, 10) || 0;
            const enabled = char.tempEnabled?.value ?? false;
            return base + (enabled ? tmpUn : 0);
        });

        char.bonusSuccesses = computed(() =>
            calculateBonusSuccesses(char.calculatedUnnatural.value)
        );
    }

}

