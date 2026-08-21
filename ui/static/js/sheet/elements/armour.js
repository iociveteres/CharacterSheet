import { effect } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { Dropdown } from "../elementsLayout.js";
import { characterState } from "../state/state.js";
import { getItemVersion } from "../state/sync.js";
import { shieldApForPart, gearArmourApForPart, armourComputed, collectEntries } from "../state/computed.js";
import { resolveStackExpr } from "../system.js";


export class ArmourPart {
    constructor(container) {
        this.container = container;
        this.partId = container.dataset.id;
        const root = container.getRootNode();

        this.dropdown = new Dropdown({
            container: this.container,
            toggleSelector: '.armour-extra-toggle',
            dropdownSelector: '.armour-extra-dropdown',
            onOpen: () => {
                this._closeOtherArmourDropdowns(root);
                this.container.style.zIndex = '100';
            },
            onClose: () => {
                this.container.style.zIndex = '';
            },
            shouldCloseOnOutsideClick: (e) => !e.target.closest('.body-part')
        });

        this.container._dropdownInstance = this.dropdown;
        this._initShieldContributions();
        this._initGearArmourContributions();
        this._initMiscContributions();
        this._initGearArmourVisibility();
    }

    _initGearArmourVisibility() {
        const armourValueLabel = this.container.querySelector('label:has([data-id="armourValue"])');
        const superArmourLabel = this.container.querySelector('label:has([data-id="superArmour"])');
        const part = this.partId;

        effect(() => {
            const hasGearArmour = armourComputed.parts[part]?.gearArmourAP.value !== null;
            if (armourValueLabel) armourValueLabel.classList.toggle('field-hidden', hasGearArmour);
            if (superArmourLabel) superArmourLabel.classList.toggle('field-hidden', hasGearArmour);
        });
    }

    _initShieldContributions() {
        const el = this.container.querySelector('.shield-contributions');
        if (!el) return;
        const part = this.partId;

        effect(() => {
            getItemVersion('meleeAttacks.list.items').value;
            const shields = [];
            for (const attack of Object.values(characterState.meleeAttacks?.list?.items ?? {})) {
                const s = attack?.shield;
                const ap = shieldApForPart(s, attack.group?.value, part);
                if (ap === null) continue;
                shields.push({ name: attack.name?.value || '—', ap });
            }

            if (!shields.length) {
                el.innerHTML = '';
                return;
            }

            el.innerHTML = `
            <div class="shield-contributions-header">Shields</div>
            ${shields.map(s => `
                <div class="layout-row shield-contribution-row">
                    <span>${s.name}</span>
                    <span>+${s.ap}</span>
                </div>
            `).join('')}
        `;
        });
    }

    _initGearArmourContributions() {
        const el = this.container.querySelector('.armour-contributions');
        if (!el) return;
        const part = this.partId;

        effect(() => {
            getItemVersion('gear.list.items').value;
            const pieces = [];
            for (const item of Object.values(characterState.gear?.list?.items ?? {})) {
                if (item.gearType?.value !== 'armour') continue;
                if (!item.equipped?.value) continue;
                const ap = gearArmourApForPart(item.armour, part, 'ap');
                const superAp = gearArmourApForPart(item.armour, part, 'superAp');
                if (ap === null && superAp === null) continue;
                pieces.push({ name: item.name?.value || '—', ap, superAp });
            }

            if (!pieces.length) {
                el.innerHTML = '';
                return;
            }

            el.innerHTML = `
            <div class="armour-contribution-header">Armour</div>
            ${pieces.map(p => `
                <div class="layout-row armour-contribution-row">
                    <span class="armour-name">${p.name}</span>
                    <span>+${p.ap ?? '-'}${p.superAp !== null ? '/' + p.superAp : ''}</span>
                </div>
            `).join('')}
        `;
        });
    }

    /**
     * Misc contributions: active bonus_ap entries from conditions/gear/cybernetics.
     * These are global, the same list shows under every body part.
     */
    _initMiscContributions() {
        const el = this.container.querySelector('.misc-contributions');
        if (!el) return;

        const AP_TYPE_LABELS = {
            natural: 'Natural',
            daemonic: 'Daemonic',
            machine: 'Machine',
            other: 'Other',
        };

        const MANUAL_FIELD_BY_TYPE = {
            natural: 'naturalArmourValue',
            daemonic: 'daemonicValue',
            machine: 'machineValue',
        };

        effect(() => {
            const entries = collectEntries('bonus_ap');

            const fromEntries = entries
                .map(({ entry, stacks, source }) => ({
                    name: source.name?.value || '—',
                    apType: entry.apType?.value || 'natural',
                    ap: resolveStackExpr(entry.apValue?.value, stacks),
                }))
                .filter(r => r.ap);

            // Treat the manual armour field for each highest-wins category as an
            // unnamed candidate competing on equal footing with condition entries —
            // it only shows up here (and only under "Misc") when it's actually the
            // winner for that category.
            const manualCandidates = Object.entries(MANUAL_FIELD_BY_TYPE)
                .map(([apType, fieldKey]) => ({
                    name: null,
                    apType,
                    ap: Number(characterState.armour?.[fieldKey]?.value) || 0,
                }))
                .filter(r => r.ap);

            const all = [...fromEntries, ...manualCandidates];

            // "other" always stacks (manual field included, summed elsewhere), so
            // every contributing condition entry is shown here. The remaining
            // categories (natural/daemonic/machine) are highest-wins against each
            // other and against the manual field, so only the single highest
            // candidate per category is shown — the rest don't affect the
            // total, and the manual field's own row is only listed if it actually won.
            const rows = [];
            const byMaxCategory = new Map();
            for (const r of all) {
                if (r.apType === 'other') {
                    rows.push(r);
                    continue;
                }
                const best = byMaxCategory.get(r.apType);
                if (!best || r.ap > best.ap) byMaxCategory.set(r.apType, r);
            }
            rows.push(...byMaxCategory.values());

            if (!rows.length) {
                el.innerHTML = '';
                return;
            }

            el.innerHTML = `
            <div class="misc-contributions-header">Misc</div>
            ${rows.map(r => `
                <div class="layout-row misc-contribution-row">
                    <span>${r.name === null ? AP_TYPE_LABELS[r.apType] || r.apType : `${r.name} <span class="misc-contribution-type">(${AP_TYPE_LABELS[r.apType] || r.apType})</span>`}</span>
                    <span>+${r.ap}</span>
                </div>
            `).join('')}
        `;
        });
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
