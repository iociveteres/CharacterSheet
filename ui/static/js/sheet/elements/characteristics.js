import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { characterState } from "../state/state.js";
import { calculateBonusSuccesses } from "../system.js";
import { getRoot } from "../utils.js";


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

        char.bonusSuccesses = computed(() => calculateBonusSuccesses(char.calculatedUnnatural.value)
        );
    }
}
