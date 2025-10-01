import {
    getTemplateInnerHTML,
    getTemplateElement
} from "./utils.js";

import {
    initDelete,
    initToggleTextarea,
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
    Tabs
} from "./elementsLayout.js";

import {
    nanoidWrapper
} from "./behaviour.js";


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
        initToggleTextarea(this.container, { toggle: ".toggle-button", textarea: ".split-description" });
        initDelete(this.container, ".delete-button");

        // 3) Paste handler to populate fields
        initPasteHandler(this.container, 'name', (text) => {
            return this.populateSplitTextField(text);
        });

        // 3a) Handle Enter key in name field to split into description
        this.nameEl.addEventListener('keydown', (e) => this.handleEnter(e));

        // 4) Initialize from `data-initial` or passed-in text
        // const fromAttr = container.dataset.initial || "";
        // this.setValue(fromAttr);
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

        // Textarea
        const textarea = document.createElement('textarea');
        textarea.className = 'split-description';
        textarea.placeholder = ' ';
        textarea.dataset.id = 'description';
        this.container.appendChild(textarea);
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

    handleEnter(e) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const pos = this.nameEl.selectionStart;
            const before = this.nameEl.value.slice(0, pos);
            const after = this.nameEl.value.slice(pos);

            this.nameEl.value = before;
            this.descEl.value = (after + "\n" + this.descEl.value).trim();

            // open the textarea pane
            this.descEl.classList.add("visible");
            this.syncCombined();

            this.descEl.focus();
            this.descEl.setSelectionRange(0, 0);
        }
    }
}


export class RangedAttack {
    constructor(container) {
        this.container = container;

        if (
            container &&
            container.classList.contains('ranged-attack') &&
            container.children.length === 0
        ) {
            this.buildStructure();
        }

        initDelete(this.container, ".delete-button");
        initPasteHandler(this.container, 'name', (text) => {
            return this.populateRangedAttack(text);
        });
    }

    buildStructure() {
        this.container.innerHTML = `
    <div class="layout-row">
        <div class="layout-row name">
            <label>Name:</label>
            <input class="long-input" data-id="name" />
        </div>
        <div class="layout-row class">
            <label>Class:</label>
            ${getTemplateInnerHTML("ranged-group-select")}
        </div>
        <div class="drag-handle"></div>
        <button class="delete-button"></button>
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
      `;
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
        const reDamage = /^(?:(?:\d+|X|N)?d(?:10|5)(?:[+-]\d+)?|\d+)$/;
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
    constructor(container, init) {
        this.container = container;
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
            this.init = [`tabs.${firstTabID}`]
        }

        initDelete(this.container, ".delete-button");

        initPasteHandler(this.container, 'name', (text) => {
            return this.populateMeleeAttack(text);
        });

        this.tabs = new Tabs(
            this.container.querySelector(".tabs"),
            this.container.dataset.id,
            {
                addBtnText: '+',
                tabContent: this.makeProfile(),
                tabLabel: this.makeLabel()
            });

    }

    buildStructure(firstTabID) {
        this.container.innerHTML = `
        <div class="layout-row">
            <div class="layout-row name">
                <label>Name:</label>
                <input class="long-input" data-id="name" />
            </div>
            <div class="layout-row group">
                <label>Group:</label>
                ${getTemplateInnerHTML("melee-group-select")}
                <div class="drag-handle"></div>
                <button class="delete-button"></button>
            </div>
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

        <div class="tabs" data-id="tabs">
            <input class="radiotab" type="radio" id="${firstTabID}"
                name="melee-attack-${this.idNumber}" checked="checked" />
            <label class="tablabel" for="${firstTabID}" data-id="${firstTabID}">
                ${getTemplateInnerHTML("melee-profiles-select")}
                <div class="drag-handle"></div>
                <button class="delete-button"></button>
            </label>
            <div data-id="${firstTabID}" class="panel">
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

            <button class="add-tab-btn">+</button>
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
            const profileName = tokens[start + i];
            const range = tokens[start + i + profileCount];
            const damage = tokens[start + 2 * i + 2 * profileCount];
            const damageType = tokens[start + 2 * i + 1 + 2 * profileCount];
            const pen = tokens[start + i + 4 * profileCount] || '';
            let special;
            if (profileCount === 1) {
                special = tokens
                    .slice(start + 2 * i + 5 * profileCount)
                    .join(' ');
            } else {
                special = specialProfiles[i];
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
            tabs: parsedTabs
        };
    }

    applyMeleePayload(payload) {
        // clear old tabs
        this.tabs.clearTabs();

        // we’re going to build a new object instead of an array
        const tabsById = {};

        // for each parsed tab entry, create a real tab
        payload.tabs.forEach(tabData => {
            const { label, panel } = this.tabs._createNewItem({ manual: false });

            // assume your <panel> has something like data-id="melee-attack-1__tab-XYZ"
            const tabId = panel.getAttribute('data-id') || panel.id;
            tabsById[tabId] = {};

            // fill both DOM and our tabsById[tabId]
            Object.entries(tabData).forEach(([path, value]) => {
                const root = (path === 'profile') ? label : panel;
                const el = root.querySelector(`[data-id="${path}"]`);
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

        // overwrite payload.tabs with our keyed object
        payload.tabs = tabsById;

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

        this.short = this.container.querySelector(".short") || this._createHeader();
        this.long = this.container.querySelector(".long");

        initToggleTextarea(this.container, { toggle: ".toggle-button", textarea: ".split-description" })
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

        const ta = createTextArea();
        ta.dataset.id = "description";
        this.container.append(ta)
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

        initToggleTextarea(this.container, { toggle: ".toggle-button", textarea: ".split-description" })
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
        const container = this.container;
        Object.entries(payload).forEach(([path, value]) => {
            const el = container.querySelector(`[data-id="${path}"]`);
            if (el) el.value = value;
        });
    }


    populatePsychicPower(paste) {
        const payload = this.parsePsychicPower(paste);
        this.applyPsychicPowerPayload(payload);
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
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.dataset.id = mod;
            fragment.appendChild(checkbox);
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

