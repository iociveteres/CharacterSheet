// What attacks and powers are tested on. The testOptions of the ranged and
// melee attacks, psykana and techno arcana list it: a characteristic or a
// skill of the sheet, and the characteristic the skill is tested on instead of
// its own. The roll of an attack or a power names an option by its id, so it
// follows the option's edits. The option's value is what
// rollBase.ts reads: "W", "awareness (I)", "custom:<id>". Cast, a Magic test
// option on a sheet with Spellcasting, reads as the characteristic each spell
// casts on, unless it names one for all of them: the caller passes `cast`, so
// the roll options don't import magic (Powers.tsx reads spellcasting.ts).
import { columnsFromLayout } from "../components/columns";
import { optionValue, type Option, type StatSet } from "../schema/constants";
import type { GridSignals } from "../schema/spec";
import { CUSTOM_SKILL_PREFIX, parseBase } from "./rollBase";
import type { SheetSignals } from "../schema/sheet";

export interface OptionGroup {
    readonly label: string;
    readonly options: readonly Option[];
}

const TEST_BLOCKS = ["rangedAttacks", "meleeAttacks", "psykana", "technoArcana"] as const;

export type TestBlock = (typeof TEST_BLOCKS)[number];

// The grids are one column, so their order is the order of that column.
const inOrder = <T>(grid: GridSignals<T> | undefined): [string, T][] =>
    grid ? columnsFromLayout(1, grid.layouts.value, Object.keys(grid.items))[0].map(id => [id, grid.items[id]]) : [];

export const isCharacteristic = (stats: StatSet, key: string) => stats.characteristics.some(c => c.key === key);

/** The base of the test option Cast. */
export const CAST = "cast";

/** The group of Cast, which the Magic test options of a sheet with Spellcasting offer before the others. */
export const CAST_GROUP: OptionGroup = { label: "Spellcasting", options: [{ value: CAST, label: "Cast" }] };

const rightSkillName = (state: SheetSignals, key: string) => state.skillsRight?.[key]?.name?.value?.trim() ?? "";

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
    for (const [id, skill] of inOrder(state.customSkills?.list)) {
        const name = skill.name?.value?.trim();
        if (name) add("Custom skills", { value: CUSTOM_SKILL_PREFIX + id, label: name });
    }
    return groups;
}

/** What a test option can be based on, by group for <optgroup>: the characteristics, then skillGroups. */
export const testBaseGroups = (state: SheetSignals, stats: StatSet): OptionGroup[] => [
    { label: "Characteristics", options: stats.characteristics.map(c => c.key) },
    ...skillGroups(state, stats),
];

/** How the base of a test option reads: "W", "Navigate: Surface", a skill's name. */
export function testBaseLabel(state: SheetSignals, stats: StatSet, base: string): string {
    if (isCharacteristic(stats, base)) return base;
    if (base === CAST) return "Cast";
    if (base.startsWith(CUSTOM_SKILL_PREFIX)) {
        const name = state.customSkills?.list?.items?.[base.slice(CUSTOM_SKILL_PREFIX.length)]?.name?.value?.trim();
        return name || "Custom skill";
    }
    const left = stats.skillsLeft.find(r => r.key === base);
    if (left) return left.group ? `${left.group}: ${left.label}` : left.label;
    const right = stats.skillsRight.find(r => r.key === base);
    if (right) return rightSkillName(state, base) || right.group || base;
    return base;
}

/** The value of a test option. A characteristic ignores the other characteristic. */
export const testOptionValue = (stats: StatSet, base: string, characteristic: string): string =>
    characteristic && !isCharacteristic(stats, base) ? `${base} (${characteristic})` : base;

/** "Awareness (I)" for "awareness (I)". */
export function testOptionLabel(state: SheetSignals, stats: StatSet, value: string): string {
    const { name, charKey } = parseBase(value);
    return charKey ? `${testBaseLabel(state, stats, name)} (${charKey})` : testBaseLabel(state, stats, name);
}

/** The characteristic the rolled spell casts on; called only when Cast names none. */
export type CastOn = () => string;

/**
 * What a roll on the option of `base` and `characteristic` is tested on;
 * Cast, the characteristic it names, else `cast`, W without a spell.
 */
function optionTest(stats: StatSet, base: string, characteristic: string, cast?: CastOn): string {
    if (base !== CAST) return testOptionValue(stats, base, characteristic);
    return characteristic || (cast ? cast() : "W");
}

/**
 * The value of the test option `id` of `block` for a roll that reads Cast as
 * `cast`, null when the block has no such option.
 */
export function rollTest(state: SheetSignals, stats: StatSet, block: TestBlock, id: string, cast?: CastOn): string | null {
    const option = state[block]?.testOptions?.items?.[id];
    return option ? optionTest(stats, option.base.value, option.characteristic.value, cast) : null;
}

/** The paths of the test options of both blocks based on `base`. */
export const testOptionsOn = (state: SheetSignals, base: string): string[] =>
    TEST_BLOCKS.flatMap(block => Object.entries(state[block]?.testOptions?.items ?? {})
        .filter(([, option]) => option.base.peek() === base)
        .map(([id]) => `${block}.testOptions.items.${id}`));

/** The test options of `block` in their order, by id. */
export const testOptionsOf = (state: SheetSignals, block: TestBlock) => inOrder(state[block]?.testOptions);

/** The id of the first test option of `block`, which a new attack or power is tested on; "" without options. */
export const firstTestOption = (state: SheetSignals, block: TestBlock): string => inOrder(state[block]?.testOptions)[0]?.[0] ?? "";

/**
 * The options of the test select of an attack or a power of `block`: the
 * block's test options in their order, by id, as a roll that reads Cast as
 * `cast` reads them: «Cast (I)». A `current` id the block has no option
 * of comes first, so the select shows that the roll has no test.
 */
export function rollTestOptions(state: SheetSignals, stats: StatSet, block: TestBlock, current: string, cast?: CastOn): Option[] {
    const options: Option[] = inOrder(state[block]?.testOptions).map(([id, o]) => {
        const test = optionTest(stats, o.base.value, o.characteristic.value, cast);
        return { value: id, label: o.base.value === CAST ? `Cast (${test})` : testOptionLabel(state, stats, test) };
    });
    if (!options.some(o => optionValue(o) === current)) {
        options.unshift({ value: current, label: current ? "(test deleted)" : "(no test)" });
    }
    return options;
}
