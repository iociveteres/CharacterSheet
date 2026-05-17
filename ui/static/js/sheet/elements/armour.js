import { effect } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { Dropdown } from "../elementsLayout.js";
import { characterState } from "../state/state.js";
import { getItemVersion } from "../state/sync.js";
import { shieldApForPart, gearArmourApForPart, armourComputed } from "../state/computed.js";


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
            <div class="armour-contributions-header">Armour</div>
            ${pieces.map(p => `
                <div class="layout-row armour-contribution-row">
                    <span class="armour-name">${p.name}</span>
                    <span>${p.ap ?? '-'}${p.superAp !== null ? '/' + p.superAp : ''}</span>
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
