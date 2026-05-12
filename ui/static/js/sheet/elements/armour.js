import { effect } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { Dropdown } from "../elementsLayout.js";
import { characterState } from "../state/state.js";
import { getItemVersion } from "../state/sync.js";
import { shieldApForPart } from "../state/computed.js";


export class ArmourPart {
    constructor(container) {
        this.container = container;
        this.partId = container.dataset.id;

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
        this._initShieldContributions();
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
                if (!s?.equipped?.value) continue;
                const ap = shieldApForPart(s, part);
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
