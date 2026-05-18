import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { nanoidWrapper, initCreateItemHandler, initDeleteItemHandler } from "../behaviour.js";
import { Tabs, Dropdown } from "../elementsLayout.js";
import { initToggleContent, initDelete, setupConditionalFields } from "../elementsUtils.js";
import { characterState } from "../state/state.js";
import { stripBrackets, getDataPath, getRoot, applyBatch } from "../utils.js";
import { getRollValue, getRollFull, initRollableDamage, rollDefaults } from "./util/rollHelpers.js";
import { createItemFromTemplate } from "./util/template.js";
import { AutocompleteOwner } from "./util/autocompleteOwner.js";
import { resolvePath, createItemInState, updateSignalBatch } from "../state/sync.js";
import { mountBindings } from "../state/bindings.js";


export class MeleeAttack {
    constructor(container, init, characteristicBlocks, { socket, autocomplete }) {
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

        setupConditionalFields(this.container, '[data-id="group"]', {
            '.shield-fields': ['primary (shield)'],
        });

        new AutocompleteOwner(this, { autocomplete, socket, collection: 'melee' });
        // handle batch events to create tabs from autocomplete properly
        this.container.addEventListener('batchRemote', e => this._handleBatchRemote(e));
    }

    renderOption(r) {
        const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
        const type = r.entryType ? r.entryType : "";

        return `
            <div class="ac-header">
                <span class="ac-name">${name}</span><span class="ac-type">${type}</span>
            </div>`;
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
     * Handles batchRemote events dispatched directly to this item's container
     * (via the targeted dispatch in network.js).
     *
     * When the batch contains a `tabs.items` structure (i.e. comes from an
     * autocompleteApply for a melee weapon), we rebuild the tab DOM and signals
     * silently — no createItemLocal / deleteItemLocal events fire, so the server
     * is not pinged again.
     *
     * Batches without `tabs.items` are ignored here and bubble up to the root
     * handler in behaviour.js as before.
     */
    _handleBatchRemote(e) {
        const { changes, path } = e.detail;
        if (!changes?.tabs?.items) return; // not a tab-structure batch — let it bubble

        e.stopPropagation();

        // 1) Apply top-level scalar fields (name, group, grip, balance, …)
        const { tabs, ...topLevel } = changes;
        if (Object.keys(topLevel).length) {
            applyBatch(this.container, topLevel);
            updateSignalBatch(path, topLevel);
        }

        // 2) The tabs container's full dot-path, e.g.
        //    "meleeAttacks.list.items.<id>.tabs.items"
        const gridPath = getDataPath(this.tabs.container);

        // 3) Blow away stale tab signals without touching the DOM yet
        const itemsNode = resolvePath(gridPath);
        if (itemsNode && typeof itemsNode === 'object') {
            for (const k of Object.keys(itemsNode)) delete itemsNode[k];
        }

        // 4) Remove old tab DOM without dispatching deleteItemLocal
        this.tabs.clearTabs({ local: false });

        // 5) Rebuild tabs from server-provided IDs and data
        for (const [tabId, tabData] of Object.entries(tabs.items)) {
            const { label, panel } = this.tabs._createNewItem({ forcedId: tabId });

            // Populate DOM fields; profile lives on the label, everything else on the panel
            for (const [key, value] of Object.entries(tabData)) {
                const dataId = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                const root = key === 'profile' ? label : panel;
                const el = root?.querySelector(`[data-id="${dataId}"]`);
                if (el) el.value = value;
            }

            // Wire up signals for the new tab
            createItemInState(gridPath, tabId, tabData);
            const tabEl = getRoot().querySelector(`[data-id="${tabId}"]`);
            if (tabEl) mountBindings(tabEl);
        }

        this.tabs.selectTab(0);
        if (this?.container.dataset.autoExpand !== 'false') {
            this?.container.classList.remove('collapsed');
        }
    }
}
