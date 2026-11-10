// The names of the sheet's skills and talents: the groups test options and
// skill_bonus entries list skills in, and how names compare. skillDifficulty
// (computed.ts) counts an entry on a skill whose name matches it after
// normalizeSkillName; a skill row of the left column is named by its key,
// e.g. "navigate_surface".
import { optionLabel, optionValue, type Option, type StatSet } from "../schema/constants";
import { normalizeSkillName } from "../system";
import type { SheetSignals } from "../schema/sheet";
import { idsInOrder } from "../core/gridOrder";
import { textAt } from "../core/sync";
import { columnsFromLayout } from "../components/columns";
import type { OptionGroup } from "../rolls/testOptionRules";

/** The prefix of a custom skill's item id in a base select. */
export const CUSTOM_SKILL_PREFIX = "custom:";

/** The name typed on a right-column skill row. */
export const rightSkillName = (state: SheetSignals, key: string) => state.skillsRight?.[key]?.name?.value?.trim() ?? "";

/**
 * The skills of the sheet by group for <optgroup>: by the group of their row,
 * then the custom skills. Skill rows and custom skills without a name are
 * left out.
 */
export function skillGroups(state: SheetSignals, stats: StatSet): OptionGroup[] {
    const groups: { label: string; options: Option[] }[] = [];
    const add = (label: string, option: Option) => {
        let group = groups.find(g => g.label === label);
        if (!group) groups.push(group = { label, options: [] });
        group.options.push(option);
    };

    for (const row of stats.skillsLeft) add(row.group ?? "Skills", { value: row.key, label: row.label });
    for (const row of stats.skillsRight) {
        const name = rightSkillName(state, row.key);
        if (name) add(row.group ?? "Skills", { value: row.key, label: name });
    }
    const custom = state.customSkills?.list;
    // One column, so its order is the order of that column.
    for (const id of custom ? columnsFromLayout(1, custom.layouts.value, Object.keys(custom.items))[0] : []) {
        const name = custom!.items[id].name?.value?.trim();
        if (name) add("Custom skills", { value: CUSTOM_SKILL_PREFIX + id, label: name });
    }
    return groups;
}

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
