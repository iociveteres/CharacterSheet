import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { characterState } from "../state/state.js";
import { calculateBonusSuccesses } from "../system.js";
import { getRoot } from "../utils.js";
import { getItemVersion } from "../state/sync.js";


export class CharacteristicBlock {
    constructor(charKey, mainBlock, permBlock) {
        this.charKey = charKey;
        this.mainBlock = mainBlock;
        this.permBlock = permBlock;

        // Main display (calculated, readonly)
        this.calcValue = mainBlock.querySelector('[data-id="calculatedValue"]');
        this.calcUnnatural = mainBlock.querySelector('[data-id="calculatedUnnatural"]');

        // Permanent inputs
        this.permValue = permBlock.querySelector('[data-id="value"]');
        this.permUnnatural = permBlock.querySelector('[data-id="unnatural"]');

        this._setupUIHandlers();
    }

    _setupUIHandlers() {
        this.calcValue?.addEventListener('click', () => {
            const dropdown = getRoot().querySelector('.characteristics-dropdown');
            if (dropdown?.classList.contains('visible')) this.permValue?.focus();
        });

        this.calcUnnatural?.addEventListener('click', () => {
            const dropdown = getRoot().querySelector('.characteristics-dropdown');
            if (dropdown?.classList.contains('visible')) this.permUnnatural?.focus();
        });
    }


    static attachComputeds(key) {
        const char = characterState.characteristics?.[key];
        if (!char) return;

        // Helper: iterate all active condition entries matching this characteristic key
        function matchingEntries(type) {
            const result = [];
            getItemVersion('conditions.list.items').value; // reactive dependency
            for (const cond of Object.values(characterState.conditions?.list?.items ?? {})) {
                if (!cond.enabled?.value) continue;
                for (const entry of Object.values(cond.entries?.items ?? {})) {
                    if (entry.type?.value !== type) continue;
                    if ((entry.name?.value ?? '').toUpperCase() !== key.toUpperCase()) continue;
                    result.push(entry);
                }
            }
            return result;
        }

        // Displayed characteristic value (caps applied)
        char.calculatedValue = computed(() => {
            getItemVersion('conditions.list.items').value;
            const base = parseInt(char.value?.value, 10) || 0;

            let bonus = 0;
            let cap = Infinity;
            for (const entry of matchingEntries('bonus_unnatural')) {
                bonus += parseInt(entry.bonus?.value, 10) || 0;
            }
            for (const entry of matchingEntries('cap')) {
                const n = parseInt(entry.cap?.value, 10);
                if (!isNaN(n) && n > 0) cap = Math.min(cap, n);
            }

            const raw = base + bonus;
            return cap === Infinity ? raw : Math.min(raw, cap);
        });

        // Unnatural characteristic value
        char.calculatedUnnatural = computed(() => {
            getItemVersion('conditions.list.items').value;
            const base = parseInt(char.unnatural?.value, 10) || 0;
            let bonus = 0;
            for (const entry of matchingEntries('bonus_unnatural')) {
                bonus += parseInt(entry.unnaturalBonus?.value, 10) || 0;
            }
            return base + bonus;
        });

        // Roll bonus from conditions (not shown on sheet, added to valueForRolls)
        char.rollBonus = computed(() => {
            getItemVersion('conditions.list.items').value;
            let total = 0;
            for (const entry of matchingEntries('roll_bonus')) {
                total += parseInt(entry.rollBonus?.value, 10) || 0;
            }
            return total;
        });

        // What roll computeds and skill tests use as the characteristic base
        char.valueForRolls = computed(() =>
            char.calculatedValue.value + char.rollBonus.value
        );

        char.bonusSuccesses = computed(() =>
            calculateBonusSuccesses(char.calculatedUnnatural.value)
        );
    }
}