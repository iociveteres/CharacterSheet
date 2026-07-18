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

        // char_override: replaces the permanent value and/or unnatural outright.
        // Value and unnatural are resolved fully independently of each other —
        // they are NOT paired per-entry. One condition can override just the value
        // (e.g. value 60, unnatural left blank) while a separate, unrelated
        // condition overrides just the unnatural (e.g. value left blank, unnatural
        // 4). Each field takes the highest override among entries that set that
        // specific field; an entry with a blank value field simply doesn't
        // participate in the value comparison (and likewise for unnatural).
        const overrideEntry = computed(() => {
            let value = null;
            let unnatural = null;

            for (const { entry, stacks } of collectEntries('char_override', charFilter)) {
                const rawValue = entry.overrideValue?.value;
                if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
                    const v = resolveStackExpr(rawValue, stacks);
                    if (value === null || v > value) value = v;
                }

                const rawUnnatural = entry.overrideUnnatural?.value;
                if (rawUnnatural !== undefined && rawUnnatural !== null && String(rawUnnatural).trim() !== '') {
                    const u = resolveStackExpr(rawUnnatural, stacks);
                    if (unnatural === null || u > unnatural) unnatural = u;
                }
            }

            return { value, unnatural };
        });

        char.calculatedValue = computed(() => {
            const override = overrideEntry.value.value;
            const base = override !== null ? override : (parseInt(char.value?.value, 10) || 0);

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
            const override = overrideEntry.value.unnatural;
            const base = override !== null ? override : (parseInt(char.unnatural?.value, 10) || 0);

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