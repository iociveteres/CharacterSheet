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

        char.calculatedValue = computed(() => {
            const base = parseInt(char.value?.value, 10) || 0;

            // Re-run when conditions are added or removed
            getItemVersion('conditions.list.items').value;

            let bonus = 0;
            let cap = Infinity;
            for (const cond of Object.values(characterState.conditions?.list?.items ?? {})) {
                if (!cond.enabled?.value) continue;
                const stat = cond.stats?.[key];
                if (!stat) continue;
                bonus += parseInt(stat.bonus?.value, 10) || 0;
                const capRaw = stat.cap?.value;
                // domToSignals stores empty number inputs as 0, so treat 0 as absent.
                // A cap of 0 on any characteristic is never meaningful in-game.
                if (capRaw !== 0 && capRaw !== '' && capRaw != null) {
                    const n = parseInt(capRaw, 10);
                    if (!isNaN(n) && n > 0) cap = Math.min(cap, n);
                }
            }

            const raw = base + bonus;
            return cap === Infinity ? raw : Math.min(raw, cap);
        });

        char.calculatedUnnatural = computed(() => {
            const base = parseInt(char.unnatural?.value, 10) || 0;

            getItemVersion('conditions.list.items').value;

            let bonus = 0;
            for (const cond of Object.values(characterState.conditions?.list?.items ?? {})) {
                if (!cond.enabled?.value) continue;
                const stat = cond.stats?.[key];
                if (stat) bonus += parseInt(stat.unnatural?.value, 10) || 0;
            }

            return base + bonus;
        });

        char.bonusSuccesses = computed(() =>
            calculateBonusSuccesses(char.calculatedUnnatural.value)
        );
    }
}