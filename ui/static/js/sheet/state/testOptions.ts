// What powers are tested on. The testOptions of psykana and techno arcana
// list it: a characteristic or a skill of the sheet, and the characteristic
// the skill is tested on instead of its own. A power's roll names an option
// by its id, so it follows the option's edits. The option's value is what
// rollBase.ts reads: "W", "awareness (I)", "custom:<id>".
import { columnsFromLayout } from "../components/columns";
import { optionValue, type Option, type StatSet } from "../schema/constants";
import type { GridSignals } from "../schema/spec";
import { CUSTOM_SKILL_PREFIX, parseBase } from "./rollBase";
import { characterState } from "./state";

export interface OptionGroup {
    readonly label: string;
    readonly options: readonly Option[];
}

export type TestBlock = "psykana" | "technoArcana";

// The grids are one column, so their order is the order of that column.
const inOrder = <T>(grid: GridSignals<T> | undefined): [string, T][] =>
    grid ? columnsFromLayout(1, grid.layouts.value, Object.keys(grid.items))[0].map(id => [id, grid.items[id]]) : [];

const isCharacteristic = (stats: StatSet, key: string) => stats.characteristics.some(c => c.key === key);

const rightSkillName = (key: string) => characterState.skillsRight?.[key]?.name?.value?.trim() ?? "";

/**
 * What a test option can be based on, by group for <optgroup>: the
 * characteristics, the skills by the group of their row, then the custom
 * skills. Skill rows and custom skills without a name are left out.
 */
export function testBaseGroups(stats: StatSet): OptionGroup[] {
    const groups: { label: string; options: Option[] }[] = [
        { label: "Characteristics", options: stats.characteristics.map(c => c.key) },
    ];
    const add = (label: string, option: Option) => {
        let group = groups.find(g => g.label === label);
        if (!group) groups.push(group = { label, options: [] });
        group.options.push(option);
    };

    for (const row of stats.skillsLeft) add(row.group ?? "Skills", { value: row.key, label: row.label });
    for (const row of stats.skillsRight) {
        const name = rightSkillName(row.key);
        if (name) add(row.group ?? "Skills", { value: row.key, label: name });
    }
    for (const [id, skill] of inOrder(characterState.customSkills?.list)) {
        const name = skill.name?.value?.trim();
        if (name) add("Custom skills", { value: CUSTOM_SKILL_PREFIX + id, label: name });
    }
    return groups;
}

/** How the base of a test option reads: "W", "Navigate: Surface", a skill's name. */
export function testBaseLabel(stats: StatSet, base: string): string {
    if (isCharacteristic(stats, base)) return base;
    if (base.startsWith(CUSTOM_SKILL_PREFIX)) {
        const name = characterState.customSkills?.list?.items?.[base.slice(CUSTOM_SKILL_PREFIX.length)]?.name?.value?.trim();
        return name || "Custom skill";
    }
    const left = stats.skillsLeft.find(r => r.key === base);
    if (left) return left.group ? `${left.group}: ${left.label}` : left.label;
    const right = stats.skillsRight.find(r => r.key === base);
    if (right) return rightSkillName(base) || right.group || base;
    return base;
}

/** The value of a test option. A characteristic ignores the other characteristic. */
export const testOptionValue = (stats: StatSet, base: string, characteristic: string): string =>
    characteristic && !isCharacteristic(stats, base) ? `${base} (${characteristic})` : base;

/** "Awareness (I)" for "awareness (I)". */
export function testOptionLabel(stats: StatSet, value: string): string {
    const { name, charKey } = parseBase(value);
    return charKey ? `${testBaseLabel(stats, name)} (${charKey})` : testBaseLabel(stats, name);
}

/** The value of the test option `id` of `block`, null when the block has no such option. */
export function powerTest(stats: StatSet, block: TestBlock, id: string): string | null {
    const option = characterState[block]?.testOptions?.items?.[id];
    return option ? testOptionValue(stats, option.base.value, option.characteristic.value) : null;
}

/** The id of the first test option of `block`, which a new power is tested on; "" without options. */
export const firstTestOption = (block: TestBlock): string => inOrder(characterState[block]?.testOptions)[0]?.[0] ?? "";

/**
 * The options of the test select of a power of `block`: the block's test
 * options in their order, by id. A `current` id the block has no option of
 * comes first, so the select shows that the power has no test.
 */
export function powerTestOptions(stats: StatSet, block: TestBlock, current: string): Option[] {
    const options: Option[] = inOrder(characterState[block]?.testOptions).map(([id, o]) =>
        ({ value: id, label: testOptionLabel(stats, testOptionValue(stats, o.base.value, o.characteristic.value)) }));
    if (!options.some(o => optionValue(o) === current)) {
        options.unshift({ value: current, label: current ? "(test deleted)" : "(no test)" });
    }
    return options;
}
