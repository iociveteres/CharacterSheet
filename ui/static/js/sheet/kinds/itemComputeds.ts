// Computed outputs of grid items that the sheet computeds read: a custom
// skill's difficulty (rolls on the skill), the cost of an advancement
// (spent experience) and the distances of a movement mode. They are placed next to the item's fields.
// createItemInState and replaced grids attach them to new items through state.ts.
import { computed } from "@preact/signals-core";
import { skillDifficulty } from "../characteristics/difficulty";
import { MOVE_COLUMNS, modeDistance } from "../combat/movement";
import { attachItemComputeds, setItemComputeds, type ItemComputeds } from "../core/state";
import { resolvePath } from "../core/sync";
import { isPowerRating, powerRatingCost, spellCost } from "../magic/spellcastingRules";
import { EXPERIENCE_LEVELS_BY_TYPE, POWER_RATING_LEVELS, optionValue } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

/**
 * Checks whether a character's alignment (e.g. "Khorne (Vanguard)" or "Undivided")
 * satisfies a comma-separated requirement list that may specify god-only ("Khorne")
 * or god+path ("Khorne (Vanguard)") entries. Case-insensitive.
 */
function alignmentMatches(charAlignment: string | null | undefined, requirementList: string | null | undefined): boolean {
    const charLower = (charAlignment ?? '').trim().toLowerCase();
    if (!charLower) return false;
    const charGod = charLower.split('(')[0].trim(); // "khorne (vanguard)" -> "khorne"

    const entries = (requirementList ?? '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    return entries.some(entry => entry === charLower || entry === charGod);
}

type CustomSkill = SheetSignals["customSkills"]["list"]["items"][string];
type Advancement = SheetSignals["experience"]["experienceLog"]["items"][string];
type MovementMode = SheetSignals["movement"]["modes"]["items"][string];

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;

function attachCustomSkill(state: SheetSignals, sk: CustomSkill) {
    sk.difficulty = computed(() => skillDifficulty(state, sk, sk.characteristic?.value || "WS", sk.name?.value));
}

function attachExperienceCost(state: SheetSignals, item: Advancement) {
    item.computedCost = computed(() => {
        const type = item.type?.value ?? '';
        if (type === 'psychicPower') return spellCost(state, num(item.experienceCost));
        if (type === 'talent' && isPowerRating(item.name?.value ?? '')) {
            const pr = clampedLevel(item, Number(optionValue(POWER_RATING_LEVELS[0])), Number(optionValue(POWER_RATING_LEVELS.at(-1)!)));
            const cost = powerRatingCost(state, pr);
            if (cost) return cost.cost;
        }
        const levels = EXPERIENCE_LEVELS_BY_TYPE[type];
        if (!levels) return num(item.experienceCost);

        const experience = state.experience;
        const useApt = !!experience?.useAptitudes?.value;
        const useDev = !!experience?.useDevotion?.value;

        // Start at neutral (1 match) when no toggles are active
        let matchCount = 1;

        if (useApt) {
            const itemApts = (item.aptitudes?.value ?? '')
                .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            const charApts = (experience?.aptitudes?.value ?? '')
                .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            if (!charApts.includes('gen')) charApts.push('gen');
            matchCount = Math.min(2, itemApts.filter(a => charApts.includes(a)).length);
        }

        if (useDev) {
            const charAlignment = experience?.alignment?.value ?? '';
            if (charAlignment && charAlignment.toLowerCase() !== 'undivided') {
                if (alignmentMatches(charAlignment, item.alliedTo?.value)) {
                    matchCount = Math.min(2, matchCount + 1);
                } else if (alignmentMatches(charAlignment, item.hostileTo?.value)) {
                    matchCount = Math.max(0, matchCount - 1);
                }
            }
        }

        return levels[clampedLevel(item, 1, levels.length) - 1].cost[matchCount];
    });
}

function attachMovementMode(state: SheetSignals, mode: MovementMode, path: string) {
    for (const column of MOVE_COLUMNS) mode[column.key] = computed(() => modeDistance(state, path, column));
}

/** The level of `item` from `first` to `last`; one left from another type may be past them, none is the first. */
function clampedLevel(item: Advancement, first: number, last: number): number {
    const raw = parseInt(item.level?.value, 10) || first;
    return Math.max(first, Math.min(last, raw));
}

// The grids whose items have computed outputs, by grid path.
const ITEM_COMPUTEDS: ItemComputeds = {
    'customSkills.list.items': attachCustomSkill,
    'experience.experienceLog.items': attachExperienceCost,
    'movement.modes.items': attachMovementMode,
};

/** Attaches the computed outputs of every item of the sheet, and of the items created later. */
export function attachAllItemComputeds(state: SheetSignals): void {
    setItemComputeds(state, ITEM_COMPUTEDS);
    for (const gridPath of Object.keys(ITEM_COMPUTEDS)) {
        const items = (resolvePath(state, gridPath) ?? {}) as Record<string, unknown>;
        for (const id of Object.keys(items)) attachItemComputeds(state, gridPath, id, items[id]);
    }
}
