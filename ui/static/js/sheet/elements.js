import {
    getTemplateInnerHTML,
    getTemplateElement,
    stripBrackets,
} from "./utils.js";

import {
    initDelete,
    initToggleContent,
    initPasteHandler,
    createDragHandle,
    createDeleteButton,
    createToggleButton,
    createTextArea,
    applyPayload
} from "./elementsUtils.js";

import {
    calculateSkillAdvancement
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
    getAttackRollBase
} from "./rolls.js"

import {
    getRoot
} from "./utils.js"

export class SplitTextField {
    constructor(container) {
        this.container = container;

        // 1) If no structure present, build it
        if (container && this.container.children.length === 0) {
            this.buildStructure();
        }

        // Store references to name and description elements
        this.nameEl = this.container.querySelector('[data-id="name"]');
        this.descEl = this.container.querySelector('[data-id="description"]');

        // 2) Wire up toggle and delete
        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });
        //setInitialCollapsedState(this.container);
        initDelete(this.container, ".delete-button");

        // 3) Paste handler to populate fields
        initPasteHandler(this.container, 'name', (text) => {
            return this.populateSplitTextField(text);
        });
    }

    buildStructure() {
        // Header
        const header = document.createElement('div');
        header.className = 'split-header';

        const input = document.createElement('input');
        input.type = 'text';
        input.dataset.id = 'name';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'toggle-button';

        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-button';

        header.append(input, toggleBtn, dragHandle, deleteBtn);
        this.container.appendChild(header);

        const collapsible = document.createElement('div');
        collapsible.className = 'collapsible-content';

        const textarea = document.createElement('textarea');
        textarea.className = 'split-description';
        textarea.placeholder = ' ';
        textarea.dataset.id = 'description';
        collapsible.appendChild(textarea)

        this.container.appendChild(collapsible);
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


export class RangedAttack {
    constructor(container, init, characteristicBlocks) {
        this.container = container;
        this.characteristicBlocks = characteristicBlocks;
        this.ID = container.dataset.id

        if (
            container &&
            container.classList.contains('ranged-attack') &&
            container.children.length === 0
        ) {
            this.buildStructure();
        }

        this.descEl = this.container.querySelector('[data-id="description"]');
        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" });

        initDelete(this.container, ".delete-button");
        initPasteHandler(this.container, 'name', (text) => {
            return this.populateRangedAttack(text);
        });

        this._initRollDropdown();
    }

    buildStructure() {
        this.container.innerHTML = `
    <div class="layout-row split-header">
        <div class="layout-row name">
            <label class="rollable">Name:</label>
            <input class="long-input" data-id="name" />
            <button class="toggle-button"></button>
        </div>
        <div class="layout-row class">
            <label>Class:</label>
            ${getTemplateInnerHTML("ranged-group-select")}
        </div>
        <div class="drag-handle"></div>
        <button class="delete-button"></button>

        ${getTemplateInnerHTML("ranged-attack-roll-template", {
            from: 'TEMPLATE_ID',
            to: this.ID,
        })}
    </div>

    <div class="layout-row">
        <div class="layout-row range">
            <label>Range:</label>
            <input data-id="range" />
        </div>
        <div class="layout-row damage">
            <label>Damage:</label>
            <input data-id="damage" />
        </div>
        <div class="layout-row pen">
            <label>Pen:</label>
            <input data-id="pen" />
        </div>
        <div class="layout-row damage-type">
            <label>Type:</label>
            ${getTemplateInnerHTML("damage-types-select")}
        </div>
    </div>
    <div class="layout-row">
        <div class="layout-row rof">
            <label>RoF:</label>
            <input data-id="rof-single" />/<input class="shorter-input"
                data-id="rof-short" />/<input class="shorter-input"
                data-id="rof-long" />
        </div>
        <div class="layout-row clip">
            <label>Clip:</label>
            <input data-id="clip-cur" />/
            <input data-id="clip-max" />
        </div>
        <div class="layout-row reload">
            <label>Reload:</label>
            <input data-id="reload" />
        </div>
    </div>
    <div class="layout-row">
        <div class="layout-row special">
            <label>Special:</label>
            <input data-id="special" />
        </div>
    </div>
    <div class="layout-row">
        <div class="layout-row upgrades">
            <label>Upgrades:</label>
            <input data-id="upgrades" />
        </div>
    </div>
    
    <div class="collapsible-content">
        <textarea class="split-description" placeholder=" " data-id="description"></textarea>
    </div>
      `;
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

        // Setup live calculation
        this._setupRollCalculation(rollContainer);

        // Setup roll button
        const rollButton = rollContainer.querySelector('[data-id="roll-button"]');
        if (rollButton) {
            rollButton.addEventListener('click', () => {
                this._handleRollClick();
                this.rollDropdown.close();
            });
        }
    }

    _setupRollCalculation(rollContainer) {
        const totalInput = rollContainer.querySelector('[data-id="total"]');
        const baseSelect = rollContainer.querySelector('[data-id="base-select"]');

        const updateTotal = () => {
            // Get base value from characteristic or skill
            const { baseValue } = getAttackRollBase(rollContainer, this.characteristicBlocks);

            let sum = baseValue;

            // Get selected values from each column
            const columns = ['aim', 'target', 'range', 'rof'];
            columns.forEach(columnId => {
                const column = rollContainer.querySelector(`[data-id="${columnId}"]`);
                if (!column) return;

                const selectedRadio = column.querySelector('input[type="radio"]:checked');
                if (!selectedRadio) return;

                const valueInput = column.querySelector(`input[data-id="${selectedRadio.value}"]`);
                if (valueInput) {
                    sum += parseInt(valueInput.value, 10) || 0;
                }
            });

            // Add extra modifiers if enabled
            ['extra1', 'extra2'].forEach(extraId => {
                const extra = rollContainer.querySelector(`[data-id="${extraId}"]`);
                if (!extra) return;

                const checkbox = extra.querySelector('[data-id="enabled"]');
                const valueInput = extra.querySelector('[data-id="value"]');

                if (checkbox?.checked && valueInput) {
                    sum += parseInt(valueInput.value, 10) || 0;
                }
            });

            totalInput.value = sum;
        };

        // Listen for all changes
        rollContainer.addEventListener('change', updateTotal);
        rollContainer.addEventListener('input', updateTotal);

        // Listen for base select changes
        if (baseSelect) {
            baseSelect.addEventListener('change', updateTotal);
        }

        const characteristicsContainer = getRoot().querySelector('.characteristics');
        characteristicsContainer.addEventListener('characteristicChanged', (event) => {
            const charId = event.detail.charKey;
            if (baseSelect.value == charId) {
                updateTotal();
            }
        });
        const skillsContainer = getRoot().getElementById('skills');
        skillsContainer.addEventListener('skillChanged', (event) => {
            const skillId = event.detail.skillKey;
            if (baseSelect.value.toLowerCase() == skillId) {
                updateTotal();
            }
        });

        // Initial calculation
        updateTotal();
    }

    // Add method to recalculate roll total (called from behaviour.js)
    recalculateRoll() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        if (rollContainer) {
            // Trigger a change event to recalculate
            rollContainer.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    _handleRollClick() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        const totalInput = rollContainer.querySelector('[data-id="total"]');
        const target = parseInt(totalInput.value, 10) || 0;

        // Get bonus successes
        const { bonusSuccesses } = getAttackRollBase(rollContainer, this.characteristicBlocks);

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
        const id = container.dataset.id
        this.idNumber = id.substring(id.lastIndexOf("-") + 1)

        let firstTabID;
        if (init?.[0] != null) {
            firstTabID = init[0].split(".")[1]
        } else {
            firstTabID = "tab-" + nanoidWrapper();
        }

        if (
            container &&
            container.classList.contains('melee-attack') &&
            container.children.length === 0
        ) {
            this.buildStructure(firstTabID);
            this.init = [`tabs.items.${firstTabID}`]
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
                tabContent: this.makeProfile(),
                tabLabel: this.makeLabel()
            });

        this._initRollDropdown();
    }

    buildStructure(firstTabID) {
        this.container.innerHTML = `
        <div class="layout-row split-header">
            <div class="layout-row name">
                <label class="rollable">Name:</label>
                <input class="long-input" data-id="name" />
                <button class="toggle-button"></button>
            </div>
            <div class="layout-row group">
                <label>Group:</label>
                ${getTemplateInnerHTML("melee-group-select")}
                <div class="drag-handle"></div>
                <button class="delete-button"></button>
            </div>

            ${getTemplateInnerHTML("melee-attack-roll-template", {
            from: 'TEMPLATE_ID',
            to: this.ID,
        })}
        </div>

        <div class="layout-row">
            <div class="layout-row grip">
                <label>Grips:</label>
                <input data-id="grip" />
            </div>
            <div class="layout-row balance">
                <label>Balance:</label>
                <input data-id="balance" />
            </div>
        </div>
        <div class="layout-row">
            <div class="layout-row upgrades">
                <label>Upgrades:</label>
                <input data-id="upgrades" />
            </div>
        </div>
        <div class="tabs" data-id="tabs.items">
            <input class="radiotab" type="radio" id="${firstTabID}"
                name="melee-attack-${this.idNumber}" checked="checked" />
            <label class="tablabel" for="${firstTabID}" data-id="${firstTabID}">
                ${getTemplateInnerHTML("melee-profiles-select")}
                <div class="drag-handle"></div>
                <button class="delete-button"></button>
            </label>
            <div data-id="${firstTabID}" class="panel">
                <div class="profile-tab">
                    <div class="layout-row">
                        <div class="layout-row range">
                            <label>Range:</label>
                            <input data-id="range" />
                        </div>
                        <div class="layout-row damage">
                            <label>Damage:</label>
                            <input data-id="damage" />
                        </div>
                        <div class="layout-row pen">
                            <label>Pen:</label>
                            <input data-id="pen" />
                        </div>
                        <div class="layout-row damage-type">
                            <label>Type:</label>
                            ${getTemplateInnerHTML("damage-types-select")}
                        </div>
                    </div>
                    <div class="layout-row">
                        <div class="layout-row special">
                            <label>Special:</label>
                            <input data-id="special" />
                        </div>
                    </div>
                </div>
            </div>
            <button class="add-tab-btn">+</button>
        </div>
        <div class="collapsible-content">
            <textarea class="split-description" placeholder=" " data-id="description"></textarea>
        </div>
      `;
    }

    makeProfile() {
        return `  
            <div class="profile-tab">
                <div class="layout-row">
                    <div class="layout-row range">
                        <label>Range:</label>
                        <input data-id="range" />
                    </div>
                    <div class="layout-row damage">
                        <label>Damage:</label>
                        <input data-id="damage" />
                    </div>
                    <div class="layout-row pen">
                        <label>Pen:</label>
                        <input data-id="pen" />
                    </div>
                    <div class="layout-row damage-type">
                        <label>Type:</label>
                        <select data-id="damage-type">
                            <option value="I">I</option>
                            <option value="I(Cr)">I(Cr)</option>
                            <option value="R">R</option>
                            <option value="X">X</option>
                            <option value="X(Fr)">X(Fr)</option>
                            <option value="E">E</option>
                            <option value="E(Ls)">E(Ls)</option>
                            <option value="E(Fl)">E(Fl)</option>
                            <option value="C">C</option>
                            <option value="C(Tx)">C(Tx)</option>
                        </select>
                    </div>
                </div>

                <div class="layout-row">
                    <div class="layout-row special">
                        <label>Special:</label>
                        <input data-id="special" />
                    </div>
                </div>
            </div>
            `
    }

    makeLabel() {
        return `<select data-id="profile">
                    <option value="mace">Mace</option>
                    <option value="glaive">Glaive</option>
                    <option value="flail">Flail</option>
                    <option value="whip">Whip</option>
                    <option value="claws">Claws</option>
                    <option value="claws.h">Claws.H</option>
                    <option value="claws.a">Claws.A</option>
                    <option value="spear">Spear</option>
                    <option value="hook">Hook</option>
                    <option value="fist">Fist</option>
                    <option value="fist.a">Fist.A</option>
                    <option value="sword">Sword</option>
                    <option value="rapier">Rapier</option>
                    <option value="saber">Saber</option>
                    <option value="hammer">Hammer</option>
                    <option value="axe">Axe</option>
                    <option value="knife">Knife</option>
                    <option value="staff">Staff</option>
                    <option value="bayonet">Bayonet</option>
                    <option value="shield">Shield</option>
                    <option value="bite">Bite</option>
                    <option value="no">No</option>
                </select>
                `
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

        // Setup live calculation
        this._setupRollCalculation(rollContainer);

        // Setup roll button
        const rollButton = rollContainer.querySelector('[data-id="roll-button"]');
        if (rollButton) {
            rollButton.addEventListener('click', () => {
                this._handleRollClick();
                this.rollDropdown.close();
            });
        }
    }

    _setupRollCalculation(rollContainer) {
        const totalInput = rollContainer.querySelector('[data-id="total"]');
        const baseSelect = rollContainer.querySelector('[data-id="base-select"]');

        const updateTotal = () => {
            // Get base value from characteristic or skill
            const { baseValue } = getAttackRollBase(rollContainer, this.characteristicBlocks);

            let sum = baseValue;

            const columns = ['aim', 'target', 'base', 'stance', 'rof'];
            columns.forEach(columnId => {
                const column = rollContainer.querySelector(`[data-id="${columnId}"]`);
                if (!column) return;

                const selectedRadio = column.querySelector('input[type="radio"]:checked');
                if (!selectedRadio) return;

                const valueInput = column.querySelector(`input[data-id="${selectedRadio.value}"]`);
                if (valueInput) {
                    sum += parseInt(valueInput.value, 10) || 0;
                }
            });

            ['extra1', 'extra2'].forEach(extraId => {
                const extra = rollContainer.querySelector(`[data-id="${extraId}"]`);
                if (!extra) return;

                const checkbox = extra.querySelector('[data-id="enabled"]');
                const valueInput = extra.querySelector('[data-id="value"]');

                if (checkbox?.checked && valueInput) {
                    sum += parseInt(valueInput.value, 10) || 0;
                }
            });

            totalInput.value = sum;
        };

        rollContainer.addEventListener('change', updateTotal);
        rollContainer.addEventListener('input', updateTotal);

        // Listen for base select changes
        if (baseSelect) {
            baseSelect.addEventListener('change', updateTotal);
        }

        const characteristicsContainer = getRoot().querySelector('.characteristics');
        characteristicsContainer.addEventListener('characteristicChanged', (event) => {
            const charId = event.detail.charKey;
            if (baseSelect.value == charId) {
                updateTotal();
            }
        });
        const skillsContainer = getRoot().getElementById('skills');
        skillsContainer.addEventListener('skillChanged', (event) => {
            const skillId = event.detail.skillKey;
            if (baseSelect.value.toLowerCase() == skillId) {
                updateTotal();
            }
        });

        updateTotal();
    }

    // Add method to recalculate roll total (called from behaviour.js)
    recalculateRoll() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        if (rollContainer) {
            // Trigger a change event to recalculate
            rollContainer.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    _handleRollClick() {
        const rollContainer = this.container.querySelector('[data-id="roll"]');
        const totalInput = rollContainer.querySelector('[data-id="total"]');
        const target = parseInt(totalInput.value, 10) || 0;

        // Get bonus successes
        const { bonusSuccesses } = getAttackRollBase(rollContainer, this.characteristicBlocks);

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

            // assume your <panel> has something like data-id="melee-attack-1__tab-XYZ"
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


export class InventoryItemField {
    constructor(container) {
        this.container = container;

        if (!this.container.classList.contains('item-with-description')) {
            this.container.classList.add('item-with-description');
        }

        this.short = this.container.querySelector(".short") || this._createHeader();
        this.long = this.container.querySelector(".long");

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" })
        //setInitialCollapsedState(this.container);
        initDelete(this.container, ".delete-button");

        initPasteHandler(this.container, 'name', (text) => {
            return this.populateInventoryItem(text);
        });
    }

    _createHeader() {
        const header = document.createElement("div");
        header.className = "split-header";
        const long = document.createElement("input");
        long.className = "long";
        long.dataset.id = "name";
        const toggle = createToggleButton();
        const short = document.createElement("input");
        short.type = "number";
        short.className = "short textlike";
        short.placeholder = "wt.";
        short.dataset.id = "weight";
        const handle = createDragHandle();
        const deleteButton = createDeleteButton()
        header.append(long, toggle, short, handle, deleteButton);
        this.container.append(header);

        const collapsible = document.createElement('div');
        collapsible.className = 'collapsible-content';

        const ta = createTextArea();
        ta.className = 'split-description';
        ta.placeholder = ' ';
        ta.dataset.id = "description";

        collapsible.appendChild(ta);
        this.container.appendChild(collapsible);
        // this.container.append(ta)
        return short;
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


export class ExperienceField {
    constructor(container) {
        this.container = container;

        this.short = this.container.querySelector(".short") || this._createHeader();
        this.long = this.container.querySelector(".long");

        initDelete(this.container, ".delete-button");
    }

    _createHeader() {
        const long = document.createElement("input");
        long.className = "long";
        long.dataset.id = "name";
        const short = document.createElement("input");
        short.type = "number";
        short.className = "short textlike";
        short.placeholder = "exp.";
        short.dataset.id = "experience-cost"
        const handle = createDragHandle();
        const deleteButton = createDeleteButton()
        this.container.append(long, short, handle, deleteButton);
        return short;
    }
}

export class ResourceTracker {
    constructor(container) {
        this.container = container;

        this.short = this.container.querySelector(".short") || this._createHeader();
        this.long = this.container.querySelector(".long");

        initDelete(this.container, ".delete-button");
    }

    _createHeader() {
        const long = document.createElement("input");
        long.className = "long";
        long.dataset.id = "name";
        const short = document.createElement("input");
        short.type = "number";
        short.className = "short";
        short.dataset.id = "value"
        const handle = createDragHandle();
        const deleteButton = createDeleteButton()
        this.container.append(long, short, handle, deleteButton);
        return short;
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
    constructor(container) {
        this.container = container;

        if (
            container &&
            container.classList.contains('psychic-power') &&
            container.children.length === 0
        ) {
            this.buildStructure();
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" })
        //setInitialCollapsedState(this.container);
        initDelete(this.container, ".delete-button")

        initPasteHandler(this.container, 'name', (text) => {
            return this.populatePsychicPower(text);
        });
    }

    buildStructure() {
        this.container.innerHTML = `
            <div class="split-header">
                <input type="text" data-id="name">
                <button class="toggle-button"></button>
                <div class="drag-handle"></div>
                <button class="delete-button"></button>
            </div>

            <div class="collapsible-content">
                <div class="layout-row">
                    <div class="layout-row subtypes">
                        <label>Subtypes:</label><input data-id="subtypes">
                    </div>
                    <div class="layout-row range">
                        <label>Range:</label><input data-id="range">
                    </div>
                </div>
                <div class="layout-row">
                    <div class="layout-row psychotest">
                        <label>Psychotest:</label><input data-id="psychotest">
                    </div>
                    <div class="layout-row action">
                        <label for="action">Action:</label><input data-id="action">
                    </div>
                    <div class="layout-row sustained">
                        <label for="sustained">Sustained:</label><input data-id="sustained">
                    </div>
                </div>
                <div class="layout-row">
                    <div class="layout-row weapon-range">
                        <label>Range:</label><input data-id="weapon-range">
                    </div>
                    <div class="layout-row damage">
                        <label for="damage">Damage:</label><input data-id="damage">
                    </div>
                    <div class="layout-row pen">
                        <label for="pen">Pen:</label><input data-id="pen">
                    </div>
                    <div class="layout-row type">
                        <label>Type:</label>
                        ${getTemplateInnerHTML("damage-types-select")}
                    </div>
                </div>
                <div class="layout-row">
                    <div class="layout-row rof">
                        <label>RoF:</label>
                        <input data-id="rof-single" />/
                        <input class="shorter-input" data-id="rof-short" />/
                        <input class="shorter-input" data-id="rof-long" />
                    </div>
                    <div class="layout-row special">
                        <label>Special:</label><input data-id="special">
                    </div>
                </div>
            
                <textarea class="split-description" placeholder=" " data-id="effect"></textarea>
            </div>
      `;
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


    applyPsychicPowerPayload(payload) {

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

        this.short = this.container.querySelector(".short") || this._fillHTML();
        this.long = this.container.querySelector(".long");

        this.selectEl = this.container.querySelector("select");
        this.checkboxEls = Array.from(
            this.container.querySelectorAll('input[type="checkbox"]')
        );
        this.difficultyInput = this.container.querySelector('input[data-id="difficulty"]');

        // interactivity is added to both skills and custom skills in initSkillsTable() in script.js

        // Hook up the delete button (if you still want row‐removal functionality)
        initDelete(this.container, ".delete-button");

        this._updateTest();
    }

    _fillHTML() {
        const fragment = document.createDocumentFragment();

        // 1) Name input
        const nameInput = document.createElement("input");
        nameInput.className = "long";
        nameInput.dataset.id = "name";
        fragment.appendChild(nameInput);

        // 2) Characteristic‐type select (pull in your template)
        const select = getTemplateElement("characteristic-select");
        fragment.appendChild(select);

        // 3) Checkboxes labeled "+0", "+10", "+20", "+30"
        const modifiers = ["+0", "+10", "+20", "+30"];
        modifiers.forEach(mod => {
            const label = document.createElement("label");
            label.className = "chk-label";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "custom";
            checkbox.dataset.id = mod;

            label.appendChild(checkbox);
            fragment.appendChild(label);
        });

        // 4) Read‐only “test” field
        const testInput = document.createElement("input");
        testInput.type = "text";
        testInput.className = "short uneditable";
        testInput.dataset.id = "difficulty";
        testInput.readOnly = true;
        fragment.appendChild(testInput);

        // 5) Drag‐handle & delete‐button (if you need them)
        const handle = createDragHandle();
        const deleteButton = createDeleteButton();
        fragment.append(handle, deleteButton);

        // Finally append all of that to the row’s container
        this.container.appendChild(fragment);

        // Return the newly created “short” input so the constructor can see it:
        return testInput;
    }

    // Called whenever we need to recalc this skill’s total
    _updateTest() {
        // 1) Which characteristic‐key is selected? (e.g. "A" or "S" or "Inf")
        const charKey = this.selectEl.value;
        const charInput = document.getElementById(charKey);
        // Fallback to 0 if it’s empty / not a number
        const baseValue = parseInt(charInput?.value, 10) || 0;

        // 2) Sum up all checked boxes
        let sum = 0;
        this.checkboxEls.forEach(cb => {
            if (!cb.checked) return;
            sum += 1
        });
        const advanceValue = calculateSkillAdvancement(sum)

        this.difficultyInput.value = baseValue + advanceValue;
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
    constructor(container) {
        this.container = container;

        if (
            container &&
            container.classList.contains('tech-power') &&
            container.children.length === 0
        ) {
            this.buildStructure();
        }

        initToggleContent(this.container, { toggle: ".toggle-button", content: ".collapsible-content" })
        //setInitialCollapsedState(this.container);
        initDelete(this.container, ".delete-button")

        initPasteHandler(this.container, 'name', (text) => {
            return this.populateTechPower(text);
        });
    }

    buildStructure() {
        this.container.innerHTML = `
            <div class="split-header">
                <input type="text" data-id="name">
                <button class="toggle-button"></button>
                <div class="drag-handle"></div>
                <button class="delete-button"></button>
            </div>

            <div class="collapsible-content">
                <div class="layout-row">
                    <div class="layout-row subtypes">
                        <label>Subtypes:</label><input data-id="subtypes">
                    </div>
                    <div class="layout-row range">
                        <label>Range:</label><input data-id="range">
                    </div>
                </div>
                <div class="layout-row">
                    <div class="layout-row implants">
                        <label for="implants">Implants:</label><input data-id="implants">
                    </div>
                    <div class="layout-row price">
                        <label for="price">Price:</label><input data-id="price">
                    </div>
                    <div class="layout-row process">
                        <label for="process">Process:</label><input data-id="process">
                    </div>
                </div>
                <div class="layout-row">
                    <div class="layout-row test">
                        <label>Psychotest:</label><input data-id="psychotest">
                    </div>
                    <div class="layout-row action">
                        <label for="action">Action:</label><input data-id="action">
                    </div>
                </div>
                <div class="layout-row">
                    <div class="layout-row weapon-range">
                        <label>Range:</label><input data-id="weapon-range">
                    </div>
                    <div class="layout-row damage">
                        <label for="damage">Damage:</label><input data-id="damage">
                    </div>
                    <div class="layout-row pen">
                        <label for="pen">Pen:</label><input data-id="pen">
                    </div>
                    <div class="layout-row type">
                        <label>Type:</label>
                        ${getTemplateInnerHTML("damage-types-select")}
                    </div>
                </div>
                <div class="layout-row">
                    <div class="layout-row rof">
                        <label>RoF:</label>
                        <input data-id="rof-single" />/
                        <input class="shorter-input" data-id="rof-short" />/
                        <input class="shorter-input" data-id="rof-long" />
                    </div>
                    <div class="layout-row special">
                        <label>Special:</label><input data-id="special">
                    </div>
                </div>
                
                <textarea class="split-description" placeholder=" " data-id="effect"></textarea>
            </div>
      `;
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

        // Get references to elements
        this.sumInput = container.querySelector('.armour-sum');
        this.totalInput = container.querySelector('.armour-total');
        this.toughnessSuper = container.querySelector('.toughness-super');
        this.superArmourSub = container.querySelector('.super-armour-sub');

        // Get input fields from dropdown
        this.armourInput = container.querySelector('[data-id="armour-value"]');
        this.extra1Input = container.querySelector('[data-id="extra1-value"]');
        this.extra2Input = container.querySelector('[data-id="extra2-value"]');
        this.superArmourInput = container.querySelector('[data-id="superarmour"]');

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

        this._setupEventHandlers();
        this._updateSum();
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

    _setupEventHandlers() {
        // Update sum when any input changes
        [this.armourInput, this.extra1Input, this.extra2Input].forEach(input => {
            input.addEventListener('input', () => {
                this._updateSum();
                this._dispatchChangeEvent();
            });
        });

        // Super armour changes don't affect sum, but still need to trigger recalculation
        this.superArmourInput.addEventListener('input', () => {
            this._dispatchChangeEvent();
        });
    }

    _updateSum() {
        const armour = parseInt(this.armourInput.value, 10) || 0;
        const extra1 = parseInt(this.extra1Input.value, 10) || 0;
        const extra2 = parseInt(this.extra2Input.value, 10) || 0;

        this.sumInput.value = armour + extra1 + extra2;
    }

    _dispatchChangeEvent() {
        this.container.dispatchEvent(new CustomEvent('armourChanged', {
            bubbles: true,
            detail: {
                partId: this.container.dataset.id,
                sum: parseInt(this.sumInput.value, 10) || 0
            }
        }));
    }

    getArmourSum() {
        return parseInt(this.sumInput.value, 10) || 0;
    }

    getSuperArmour() {
        return parseInt(this.superArmourInput.value, 10) || 0;
    }

    setTotal(total, toughnessBase, superArmour) {
        this.totalInput.value = total;
        this.toughnessSuper.value = toughnessBase;
        this.superArmourSub.value = superArmour;
    }
}

export class PowerShield {
    constructor(container) {
        this.container = container;

        // Add power-shield class if not present
        if (!this.container.classList.contains('power-shield')) {
            this.container.classList.add('power-shield');
        }

        // Build structure if container is empty
        if (container && this.container.children.length === 0) {
            this.buildStructure();
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

        // Paste handler to populate fields
        // initPasteHandler(this.container, 'name', (text) => {
        //     return this.populatePowerShield(text);
        // });
    }

    buildStructure() {
        this.container.innerHTML = `
            <div class="split-header">
                <div class="layout-row name">
                    <label>Name:</label>
                    <input type="text" data-id="name" >
                </div>
                <button class="toggle-button"></button>
                <div class="drag-handle"></div>
                <button class="delete-button"></button>
            </div>

            <div class="collapsible-content">
                <div class="layout-row">
                     <div class="layout-row rating">
                        <label>Rating:</label>
                        <input type="text" data-id="rating" />
                    </div>
                    <div class="layout-row nature">
                        <label>Nature:</label>
                        <select data-id="nature">
                            <option value="tech">Tech</option>
                            <option value="arcane">Arcane</option>
                        </select>
                    </div>
                    <div class="layout-row type">
                        <label>Type:</label>
                        <select data-id="type">
                            <option value="dome">Dome</option>
                            <option value="phase">Phase</option>
                            <option value="deflector">Deflector</option>
                        </select>
                    </div>
                </div>
                <textarea class="split-description" placeholder=" " data-id="description"></textarea>
            </div>
        `;
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
        this.calcValue = mainBlock.querySelector('[data-id="calculated-value"]');
        this.calcUnnatural = mainBlock.querySelector('[data-id="calculated-unnatural"]');

        // Permanent inputs - use "value" and "unnatural" not "perm-"
        this.permValue = permBlock.querySelector('[data-id="value"]');
        this.permUnnatural = permBlock.querySelector('[data-id="unnatural"]');

        // Temporary inputs
        this.tempEnabled = tempBlock.querySelector('[data-id="temp-enabled"]');
        this.tempValue = tempBlock.querySelector('[data-id="temp-value"]');
        this.tempUnnatural = tempBlock.querySelector('[data-id="temp-unnatural"]');

        this._setupEventHandlers();
        this._updateCalculated();
    }

    _setupEventHandlers() {
        // Update calculated when permanent changes
        [this.permValue, this.permUnnatural].forEach(input => {
            input?.addEventListener('input', () => {
                this._updateCalculated();
                this._dispatchChangeEvent();
            });
        });

        // Update calculated when temporary changes
        [this.tempValue, this.tempUnnatural].forEach(input => {
            input?.addEventListener('input', () => {
                this._updateCalculated();
                this._dispatchChangeEvent();
            });
        });

        // Handle checkbox like skills - dispatch custom event with boolean
        this.tempEnabled?.addEventListener('change', () => {
            this._updateCalculated();
            this._dispatchChangeEvent();
        });

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

    _updateCalculated() {
        const permVal = parseInt(this.permValue?.value, 10) || 0;
        const permUn = parseInt(this.permUnnatural?.value, 10) || 0;
        let tempVal = 0;
        let tempUn = 0;
        if (this.tempEnabled?.checked) {
            tempVal = parseInt(this.tempValue?.value, 10) || 0;
            tempUn = parseInt(this.tempUnnatural?.value, 10) || 0;
        }
        const totalValue = permVal + tempVal;
        const totalUnnatural = permUn + tempUn;

        // Only show value if non-zero
        this.calcValue.value = totalValue === 0 ? '' : totalValue;
        this.calcUnnatural.value = totalUnnatural === 0 ? '' : totalUnnatural;
    }

    _dispatchChangeEvent() {
        // Dispatch event for skills/armor calculations to listen to
        this.mainBlock.dispatchEvent(new CustomEvent('characteristicChanged', {
            bubbles: true,
            detail: {
                charKey: this.charKey,
                value: parseInt(this.calcValue.value, 10) || 0,
                unnatural: parseInt(this.calcUnnatural.value, 10) || 0
            }
        }));
    }

    getValue() {
        return parseInt(this.calcValue.value, 10) || 0;
    }

    getUnnatural() {
        return parseInt(this.calcUnnatural.value, 10) || 0;
    }
}

