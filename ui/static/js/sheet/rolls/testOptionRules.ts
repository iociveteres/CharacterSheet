// What attacks and powers are tested on. The testOptions of the ranged and
// melee attacks, psykana and techno arcana list it: a characteristic or a
// skill of the sheet, and the characteristic the skill is tested on instead of
// its own. The roll of an attack or a power names an option by its id, so it
// follows the option's edits. The option's value is what
// rollBase.ts reads: "W", "awareness (I)", "custom:<id>". Cast, a Magic test
// option on a sheet with Spellcasting, reads as the characteristic each spell
// casts on, unless it names one for all of them: the caller passes `cast`, so
// the roll options don't import magic (Powers.tsx reads spellcastingRules.ts).
import { columnsFromLayout } from "../core/columns";
import { optionValue, type Option, type OptionGroup, type StatSet } from "../schema/constants";
import type { GridSignals } from "../schema/spec";
import { parseBase } from "./rollBase";
import { CUSTOM_SKILL_PREFIX, rightSkillName, skillGroups } from "../characteristics/skillNames";
import type { SheetSignals } from "../schema/sheet";
import { t } from "../../i18n";

const TEST_BLOCKS = ["rangedAttacks", "meleeAttacks", "psykana", "technoArcana"] as const;

export type TestBlock = (typeof TEST_BLOCKS)[number];

// The grids are one column, so their order is the order of that column.
const inOrder = <T>(grid: GridSignals<T> | undefined): [string, T][] =>
    grid ? columnsFromLayout(1, grid.layouts.value, Object.keys(grid.items))[0].map(id => [id, grid.items[id]]) : [];

export const isCharacteristic = (stats: StatSet, key: string) => stats.characteristics.some(c => c.key === key);

/** The base of the test option Cast. */
export const CAST = "cast";

/** The group of Cast, which the Magic test options of a sheet with Spellcasting offer before the others. */
export const CAST_GROUP: OptionGroup = { label: t("sheet.termsPf.magic.spellcasting"), options: [{ value: CAST, label: t("sheet.termsPf.magic.cast") }] };

/** What a test option can be based on, by group for <optgroup>: the characteristics, then skillGroups. */
export const testBaseGroups = (state: SheetSignals, stats: StatSet): OptionGroup[] => [
    { label: t("sheet.terms.block.characteristics"), options: stats.characteristics.map(c => c.key) },
    ...skillGroups(state, stats),
];

/**
 * Whether `base` is a custom skill the sheet no longer has. A test option on
 * it stays and says so, as other dangling references do; the player removes it.
 */
export function isDeletedSkill(state: SheetSignals, base: string): boolean {
    if (!base.startsWith(CUSTOM_SKILL_PREFIX)) return false;
    // The layouts change with the items, so a reader updates once the skill is deleted.
    return !state.customSkills?.list?.layouts.value[base.slice(CUSTOM_SKILL_PREFIX.length)];
}

/** Whether the test option `id` of `block` is on a deleted custom skill: a roll on it counts nothing for the skill. */
export function onDeletedSkill(state: SheetSignals, block: TestBlock, id: string): boolean {
    const option = state[block]?.testOptions?.items?.[id];
    return !!option && isDeletedSkill(state, option.base.value);
}

/** How the base of a test option reads: "W", "Navigate: Surface", a skill's name. */
export function testBaseLabel(state: SheetSignals, stats: StatSet, base: string): string {
    if (isCharacteristic(stats, base)) return base;
    if (base === CAST) return t("sheet.termsPf.magic.cast");
    if (base.startsWith(CUSTOM_SKILL_PREFIX)) {
        if (isDeletedSkill(state, base)) return t("sheet.rolls.test.skillDeletedMark");
        const name = state.customSkills?.list?.items?.[base.slice(CUSTOM_SKILL_PREFIX.length)]?.name?.value?.trim();
        return name || t("sheet.rolls.test.customSkill");
    }
    const left = stats.skillsLeft.find(r => r.key === base);
    if (left) return left.groupLabel ? `${left.groupLabel}: ${left.label}` : left.label;
    const right = stats.skillsRight.find(r => r.key === base);
    if (right) return rightSkillName(state, base) || right.groupLabel || base;
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
        return { value: id, label: o.base.value === CAST ? `${t("sheet.termsPf.magic.cast")} (${test})` : testOptionLabel(state, stats, test) };
    });
    if (!options.some(o => optionValue(o) === current)) {
        options.unshift({ value: current, label: current ? t("sheet.rolls.test.testDeleted") : t("sheet.rolls.test.noTest") });
    }
    return options;
}
