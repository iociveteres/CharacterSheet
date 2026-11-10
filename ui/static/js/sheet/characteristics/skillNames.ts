// The names skill_bonus entries go by. skillDifficulty (computed.ts) counts an
// entry on a skill whose name matches it after normalizeSkillName; a skill row
// of the left column is named by its key, e.g. "navigate_surface".
import { optionLabel, optionValue, type StatSet } from "../schema/constants";
import { normalizeSkillName } from "../system";
import type { SheetSignals } from "../schema/sheet";
import { idsInOrder } from "../core/gridOrder";
import { textAt } from "../core/sync";
import { skillGroups, type OptionGroup } from "../rolls/testOptionRules";

/**
 * The skills of the sheet in the groups of test options, each with the name an
 * entry matches it by: "Navigate Surface" for the Surface row of Navigate.
 */
export function skillNameGroups(state: SheetSignals, stats: StatSet): OptionGroup[] {
    return skillGroups(state, stats).map(g => ({
        label: g.label,
        options: g.options.map(o => {
            const label = optionLabel(o);
            const row = stats.skillsLeft.find(r => r.key === optionValue(o));
            return { value: row?.group ? `${row.group} ${label}` : label, label };
        }),
    }));
}

/** Whether a skill of the sheet goes by `name`. */
export function namesSheetSkill(state: SheetSignals, stats: StatSet, name: string): boolean {
    const wanted = normalizeSkillName(name);
    return skillNameGroups(state, stats).some(g => g.options.some(o => normalizeSkillName(optionValue(o)) === wanted));
}

/** A skill or talent name as tests, talents and the sheet are compared by: case, dashes and the spaces around parentheses ignored. */
export const nameKey = (name: string) => name.toLowerCase().replace(/[-_\s]+/g, " ").replace(/\s*([()])\s*/g, "$1").trim();

/** The names of the talents list; not the experience log, where starting talents may be missing. */
export const talentNames = (state: SheetSignals) =>
    idsInOrder(state, "talents.list.items").map(id => textAt(state, `talents.list.items.${id}.name`).trim());
