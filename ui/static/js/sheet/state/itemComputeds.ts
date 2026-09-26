// Computed outputs of grid items that the sheet computeds read: a custom
// skill's difficulty (rolls on the skill) and the cost of an advancement
// (spent experience). They are placed next to the item's fields.
// createItemInState and replaced grids attach them to new items.
import { computed } from "@preact/signals-core";
import { characterState } from "./state";
import { skillDifficulty } from "./computed";
import { resolvePath } from "./sync";
import { alignmentMatches } from "../system";
import { EXPERIENCE_LEVELS_BY_TYPE } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

type CustomSkill = SheetSignals["customSkills"]["list"]["items"][string];
type Advancement = SheetSignals["experience"]["experienceLog"]["items"][string];

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;

function attachCustomSkill(sk: CustomSkill) {
    sk.difficulty = computed(() => skillDifficulty(sk, sk.characteristic?.value || "WS", sk.name?.value));
}

function attachExperienceCost(item: Advancement) {
    item.computedCost = computed(() => {
        const levels = EXPERIENCE_LEVELS_BY_TYPE[item.type?.value ?? ''];
        if (!levels) return num(item.experienceCost);

        const experience = characterState.experience;
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

        // A level left from another type may be above the last one.
        const raw = parseInt(item.level?.value, 10) || 1;
        return levels[Math.max(0, Math.min(levels.length - 1, raw - 1))].cost[matchCount];
    });
}

// The grids whose items have computed outputs, by grid path.
const ITEM_COMPUTEDS: { [gridPath: string]: ((item: never) => void) | undefined } = {
    'customSkills.list.items': attachCustomSkill,
    'experience.experienceLog.items': attachExperienceCost,
};

/** Attaches the computed outputs of the item `itemId` of the grid at `gridPath`, if it has any. */
export function attachItemComputeds(gridPath: string, itemId: string): void {
    const attach = ITEM_COMPUTEDS[gridPath];
    const item = attach && resolvePath(`${gridPath}.${itemId}`);
    if (item && typeof item === 'object') attach(item as never);
}

/** Attaches the computed outputs of every item of the sheet. */
export function attachAllItemComputeds(): void {
    for (const gridPath of Object.keys(ITEM_COMPUTEDS)) {
        for (const id of Object.keys(resolvePath(gridPath) ?? {})) attachItemComputeds(gridPath, id);
    }
}
