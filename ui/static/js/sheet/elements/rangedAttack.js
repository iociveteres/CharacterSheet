import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { Dropdown } from "../elementsLayout.js";
import { initToggleContent, initDelete, initPasteHandler, applyPayload } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { getRollValue, getRollFull, initRollableDamage, rollDefaults } from "./util/rollHelpers.js";
import { createItemFromTemplate } from "./util/template.js";


export class RangedAttack {
    constructor(container, init, characteristicBlocks) {
        this.container = container;
        this.characteristicBlocks = characteristicBlocks;
        this.ID = container.dataset.id;

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
        const rawClassKey = Object.keys(classMap).find(key => fullStatLine.toLowerCase().startsWith(key)
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
