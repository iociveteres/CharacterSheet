// The names of the sheet's skills and talents: the groups test options and
// skill_bonus entries list skills in, and how names compare. skillDifficulty
// (computed.ts) counts an entry on a skill whose name matches it after
// normalizeSkillName; a skill row of the left column is named by its key,
// e.g. "navigate_surface".
import { optionLabel, optionValue, type Option, type StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { idsInOrder } from "../core/gridOrder";
import { textAt } from "../core/sync";
import { columnsFromLayout } from "../core/columns";
import { sheetComputed, statsOf } from "../core/state";
import type { OptionGroup } from "../schema/constants";
import { t } from "../../i18n";

export function normalizeSkillName(s: string | null | undefined): string {
    return (s ?? '').toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

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

    for (const row of stats.skillsLeft) add(row.groupLabel ?? t("sheet.terms.block.skills"), { value: row.key, label: row.label });
    for (const row of stats.skillsRight) {
        const name = rightSkillName(state, row.key);
        if (name) add(row.groupLabel ?? t("sheet.terms.block.skills"), { value: row.key, label: name });
    }
    const custom = state.customSkills?.list;
    // One column, so its order is the order of that column.
    for (const id of custom ? columnsFromLayout(1, custom.layouts.value, Object.keys(custom.items))[0] : []) {
        const name = custom!.items[id].name?.value?.trim();
        if (name) add(t("sheet.terms.block.customSkills"), { value: CUSTOM_SKILL_PREFIX + id, label: name });
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
            if (!row) return { value: label, label };
            return { value: row.group ? `${row.group} ${row.name}` : row.name, label };
        }),
    }));
}

/**
 * The names an entry matches the skills of the sheet by, normalized: one set
 * per sheet, which keeps its value while they stay the same. Each skill_bonus
 * entry checks its name against it, so typing a skill's name wakes them once.
 */
const sheetSkillNames = sheetComputed(
    state => new Set(skillNameGroups(state, statsOf(state)).flatMap(g => g.options.map(o => normalizeSkillName(String(optionValue(o)))))),
    (prev, next) => prev.size === next.size && [...prev].every(n => next.has(n)),
);

/** Whether a skill of the sheet goes by `name`. */
export const namesSheetSkill = (state: SheetSignals, name: string): boolean => sheetSkillNames(state).has(normalizeSkillName(name));

/** A skill or talent name as tests, talents and the sheet are compared by: case, dashes and the spaces around parentheses ignored. */
export const nameKey = (name: string) => name.toLowerCase().replace(/[-_\s]+/g, " ").replace(/\s*([()])\s*/g, "$1").trim();

/**
 * The names of the talents list; not the experience log, where starting
 * talents may be missing. Every damage field reads them: the same array while
 * the names stay the same.
 */
export const talentNames: (state: SheetSignals) => readonly string[] = sheetComputed(
    state => idsInOrder(state, "talents.list.items").map(id => textAt(state, `talents.list.items.${id}.name`).trim()),
    (prev, next) => prev.length === next.length && prev.every((name, i) => name === next[i]),
);
