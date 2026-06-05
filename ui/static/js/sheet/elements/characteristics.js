import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { characterState } from "../state/state.js";
import { collectEntries } from "../state/computed.js";
import { calculateBonusSuccesses } from "../system.js";
import { getRoot } from "../utils.js";
import { getItemVersion } from "../state/sync.js";
import { resolveStackExpr } from "../system.js";

const FATIGUE_ALL = new Set(['WS', 'BS', 'S', 'A', 'I', 'P', 'W', 'F']);
const FATIGUE_MENTAL = new Set(['I', 'P', 'W', 'F']);
const FATIGUE_PHYSICAL = new Set(['WS', 'BS', 'S', 'A']);

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

        const charFilter = e => e.name?.value?.toUpperCase() === key.toUpperCase();

        char.calculatedValue = computed(() => {
            const base = parseInt(char.value?.value, 10) || 0;
            let bonus = 0, cap = Infinity;
            for (const { entry, stacks } of collectEntries('char_bonus', charFilter)) {
                bonus += resolveStackExpr(entry.bonus?.value, stacks);
            }
            for (const { entry, stacks } of collectEntries('char_cap', charFilter)) {
                const n = resolveStackExpr(entry.cap?.value, stacks);
                if (n > 0) cap = Math.min(cap, n);
            }
            const raw = base + bonus;
            return cap === Infinity ? raw : Math.min(raw, cap);
        });

        char.calculatedUnnatural = computed(() => {
            const base = parseInt(char.unnatural?.value, 10) || 0;
            return base + collectEntries('char_bonus', charFilter)
                .reduce((acc, { entry, stacks }) =>
                    acc + resolveStackExpr(entry.unnaturalBonus?.value, stacks), 0);
        });

        char.rollBonus = computed(() => {
            let total = collectEntries('roll_bonus', charFilter)
                .reduce((acc, { entry, stacks }) =>
                    acc + resolveStackExpr(entry.rollBonus?.value, stacks), 0);

            const cur = Number(characterState.fatigue?.fatigueCur?.value) || 0;
            if (cur > 0) {
                const mode = characterState.fatigue?.fatigueMode?.value ?? 'all';
                const affected =
                    mode === 'mental' ? FATIGUE_MENTAL :
                        mode === 'physical' ? FATIGUE_PHYSICAL :
                            mode === 'nothing' ? null :
                                FATIGUE_ALL;

                if (affected?.has(key)) total -= 10;
            }

            return total;
        });

        char.valueForRolls = computed(() =>
            char.calculatedValue.value + char.rollBonus.value
        );

        char.bonusSuccesses = computed(() =>
            calculateBonusSuccesses(char.calculatedUnnatural.value)
        );
    }
}