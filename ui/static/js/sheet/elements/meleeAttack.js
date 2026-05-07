import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { nanoidWrapper, initCreateItemHandler, initDeleteItemHandler } from "../behaviour.js";
import { Tabs, Dropdown } from "../elementsLayout.js";
import { initToggleContent, initDelete, initPasteHandler } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { stripBrackets } from "../utils.js";
import { getRollValue, getRollFull, initRollableDamage, rollDefaults } from "./util/rollHelpers.js";
import { createItemFromTemplate } from "./util/template.js";


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
        this.IDNumber = this.ID.substring(this.ID.lastIndexOf("-") + 1);

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
        ];

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
