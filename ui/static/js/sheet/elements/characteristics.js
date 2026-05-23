import { computed } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { characterState } from "../state/state.js";
import { calculateBonusSuccesses } from "../system.js";
import { getRoot } from "../utils.js";
import { getItemVersion } from "../state/sync.js";

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

        // Iterate all active entries from both standalone conditions and gear items
        // that match the given characteristic key and entry type.
        function matchingEntries(type) {
            const result = [];
            getItemVersion('conditions.list.items').value;
            getItemVersion('gear.list.items').value;
            getItemVersion('cybernetics.list.items').value;

            // Standalone conditions — gated by enabled checkbox
            for (const cond of Object.values(characterState.conditions?.list?.items ?? {})) {
                if (!cond.enabled?.value) continue;
                for (const entry of Object.values(cond.entries?.items ?? {})) {
                    if (entry.type?.value !== type) continue;
                    if ((entry.name?.value ?? '').toUpperCase() !== key.toUpperCase()) continue;
                    result.push(entry);
                }
            }

            // Gear item entries — gated by top-level equipped signal
            for (const item of Object.values(characterState.gear?.list?.items ?? {})) {
                if (!item.equipped?.value) continue;          // ← top-level, not armour.equipped
                for (const entry of Object.values(item.entries?.items ?? {})) {
                    if (entry.type?.value !== type) continue;
                    if ((entry.name?.value ?? '').toUpperCase() !== key.toUpperCase()) continue;
                    result.push(entry);
                }
            }

            // Cybernetics entries
            for (const item of Object.values(characterState.cybernetics?.list?.items ?? {})) {
                // No equipped gate — cybernetics are always active
                for (const entry of Object.values(item.entries?.items ?? {})) {
                    if (entry.type?.value !== type) continue;
                    if ((entry.name?.value ?? '').toUpperCase() !== key.toUpperCase()) continue;
                    result.push(entry);
                }
            }


            return result;
        }

        char.calculatedValue = computed(() => {
            getItemVersion('conditions.list.items').value;
            getItemVersion('gear.list.items').value;
            getItemVersion('cybernetics.list.items').value;
            const base = parseInt(char.value?.value, 10) || 0;

            let bonus = 0;
            let cap = Infinity;
            for (const entry of matchingEntries('char_bonus')) {
                bonus += parseInt(entry.bonus?.value, 10) || 0;
            }
            for (const entry of matchingEntries('char_cap')) {
                const n = parseInt(entry.cap?.value, 10);
                if (!isNaN(n) && n > 0) cap = Math.min(cap, n);
            }

            const raw = base + bonus;
            return cap === Infinity ? raw : Math.min(raw, cap);
        });

        char.calculatedUnnatural = computed(() => {
            getItemVersion('conditions.list.items').value;
            getItemVersion('gear.list.items').value;
            getItemVersion('cybernetics.list.items').value;
            const base = parseInt(char.unnatural?.value, 10) || 0;
            let bonus = 0;
            for (const entry of matchingEntries('char_bonus')) {
                bonus += parseInt(entry.unnaturalBonus?.value, 10) || 0;
            }
            return base + bonus;
        });

        char.rollBonus = computed(() => {
            getItemVersion('conditions.list.items').value;
            getItemVersion('gear.list.items').value;
            getItemVersion('cybernetics.list.items').value;
            let total = 0;
            for (const entry of matchingEntries('roll_bonus')) {
                total += parseInt(entry.rollBonus?.value, 10) || 0;
            }

            // Fatigue: active when fatigueCur > 0
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