// Sorcery, the casting of the half-casters of Pathfinder Crusade (wiki «v
// магия › недоспелкастинг»): a spell typed Sorcery (Bard) takes no PR, has
// no phenomena and pays its Level from the Focus of its class, a pool of the
// Spellcasting variant naming the class (_prd/sheet_kinds/spellcasting.md).
// One spell of any class is sustained at most, two with the talent Expanded
// Sustain, and casting while two are sustained is −10. The test is the skill
// the spell names, its ePR at most the level of that skill. Rules and
// decisions: _prd/sheet_kinds/half_casters.md.
import { SKILL_ADVANCES } from "./computed";
import { idsInOrder } from "./gridOrder";
import { isSorcery, powerTraitsAt, psychicPowers, psykanaRule, sustainedPowers, type SustainedPower } from "./psychic";
import { nameKey, skillFullName } from "./magicTest";
import { findSkill, getRollValue } from "./rollBase";
import { numberAt, textAt, valueAt } from "./sync";
import { statsOf } from "./state";
import { testBaseLabel } from "./testOptions";
import type { SpellcastingVariant, StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import type { ManaPool } from "./mana";

/** The names of the talents list; not the experience log, where starting talents may be missing. */
const talentNames = (state: SheetSignals) =>
    idsInOrder(state, "talents.list.items").map(id => textAt(state, `talents.list.items.${id}.name`).trim());

const EXPANDED_SUSTAIN = ["expanded sustain", "расширенное поддержание"];

/** Whether the talents list has Expanded Sustain. */
export const expandedSustain = (state: SheetSignals) => talentNames(state).some(name => EXPANDED_SUSTAIN.includes(nameKey(name)));

/** What a Magic test to cast gets while two Sorcery spells are sustained (Expanded Sustain). */
export const SUSTAIN_PENALTY = -10;

export interface SorcerySustained {
    /** In the order of the tabs; they take no PR. */
    powers: SustainedPower[];
    /** The sustained casts, a Repeatable spell's each. */
    count: number;
    /** How many can be sustained: 1, 2 with Expanded Sustain. */
    limit: number;
    /** What a cast's test gets from them: −10 while two are sustained. */
    penalty: number;
    /** The mana their Upkeep costs a turn together. */
    upkeep: number;
}

/**
 * The Sorcery spells marked sustained, while the sheet counts sustained
 * spells (settings.psykana.sustained). Without the spell at `exceptPath`, as
 * while it is cast again.
 */
export function sorcerySustained(state: SheetSignals, exceptPath?: string): SorcerySustained {
    const limit = expandedSustain(state) ? 2 : 1;
    const powers: SustainedPower[] = [];
    const counted = psykanaRule(state, "sustained") ? psychicPowers(state) : [];
    for (const { path, tabId } of counted) {
        if (path === exceptPath || !isSorcery(state, path)) continue;
        const copies = numberAt(state, `${path}.sustain.copies`);
        if (copies <= 0) continue;
        powers.push({
            path, tabId, copies,
            name: textAt(state, `${path}.name`).trim() || "Spell",
            pr: numberAt(state, `${path}.sustain.pr`),
            free: false, overFree: false, taken: 0, sorcery: true,
            upkeep: (powerTraitsAt(state, path).upkeep ?? 0) * copies,
        });
    }
    const count = powers.reduce((sum, p) => sum + p.copies, 0);
    return { powers, count, limit, penalty: count >= 2 ? SUSTAIN_PENALTY : 0, upkeep: powers.reduce((sum, p) => sum + p.upkeep, 0) };
}

/** The Focus pool of the Sorcery variant `key`. */
export const focusPool = (key: string): ManaPool => `focus.${key}`;

/** The Focus pools of the kind, a Sorcery variant's each, in their order. */
export const focusPools = (stats: StatSet): ManaPool[] => stats.spellcasting.filter(v => v.way === "sorcery").map(v => focusPool(v.key));

/** The Sorcery variant whose Focus `pool` is; undefined for the mana. */
export const focusVariant = (stats: StatSet, pool: ManaPool): SpellcastingVariant | undefined =>
    stats.spellcasting.find(v => v.way === "sorcery" && focusPool(v.key) === pool);

/** The class of the Sorcery spell at `powerPath`, "Bard"; null for a PR spell. */
export const sorceryClass = (state: SheetSignals, powerPath: string): string | null =>
    (isSorcery(state, powerPath) ? powerTraitsAt(state, powerPath).sorcery! : null);

/**
 * The pool a cast of the Sorcery spell at `powerPath` pays from: the Focus of
 * the variant whose classes name its class, case ignored; null for a class no
 * variant names, Sorcery (Druid), and for a PR spell.
 */
export function sorceryPool(state: SheetSignals, powerPath: string): ManaPool | null {
    const cls = sorceryClass(state, powerPath);
    if (cls === null) return null;
    const variant = statsOf(state).spellcasting.find(v => v.way === "sorcery" && v.classes?.some(c => nameKey(c) === nameKey(cls)));
    return variant ? focusPool(variant.key) : null;
}

/** Whether the sheet has a Sorcery spell paid from `pool`, or of any class without it. */
export const hasSorcerySpellOf = (state: SheetSignals, pool: ManaPool) =>
    psychicPowers(state).some(({ path }) => sorceryPool(state, path) === pool);

/** Whether the sheet has a Sorcery spell: its row shows in the Magic tab. */
export const hasSorcerySpell = (state: SheetSignals) => psychicPowers(state).some(({ path }) => isSorcery(state, path));

/**
 * Whether the sheet shows what casting by PR needs: while it has a spell cast
 * by PR, a base PR or no spells at all. A pure bard has none of it.
 */
export const showsPR = (state: SheetSignals) => {
    const powers = psychicPowers(state);
    return powers.length === 0 || numberAt(state, "psykana.basePR") > 0 || powers.some(({ path }) => !isSorcery(state, path));
};

/**
 * The sustained spells of both ways in the order of the tabs, as one list
 * shows them; the PR ones with what Cycle makes of them.
 */
export function allSustained(state: SheetSignals): SustainedPower[] {
    const order = psychicPowers(state).map(p => p.path);
    return [...sustainedPowers(state).powers, ...sorcerySustained(state).powers].sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
}

/**
 * The spell at `powerPath` cast again: a spell other than Repeatable ends its
 * own sustaining first, so the sustained ones are counted without it.
 */
export const sorceryRecast = (state: SheetSignals, powerPath: string) =>
    sorcerySustained(state, powerTraitsAt(state, powerPath).repeatable === undefined ? powerPath : undefined);

/** The test of the roll at `rollPath` as rollBase.ts reads it: "deceive (F)", "deceive" on the skill's own characteristic, "" without a skill. */
export function sorceryTest(state: SheetSignals, rollPath: string): string {
    const skill = textAt(state, `${rollPath}.skill`);
    const characteristic = textAt(state, `${rollPath}.characteristic`);
    return skill && characteristic ? `${skill} (${characteristic})` : skill;
}

const MASTERY = /^(?:mastery|мастерство)\((.+)\)$/;
const BARE_MASTERY = ["mastery", "мастерство"];

/**
 * The names a Mastery (<skill>) can give the skill `base`, as nameKey makes
 * them: its full name, "Navigation (Surface)", or what is in its parentheses,
 * "Surface".
 */
function masteryNames(state: SheetSignals, stats: StatSet, base: string): string[] {
    const full = skillFullName(state, stats, base);
    const inner = full.match(/\(([^()]+)\)\s*$/)?.[1];
    return [full, ...(inner ? [inner] : [])].filter(Boolean).map(nameKey);
}

/** What the level of a skill reads as by its advances, 1 to 4. */
const ADVANCE_LABELS = ["", "+0", "+10", "+20", "+30"];

export interface SorceryCap {
    /** The highest ePR of a cast: the skill's level, 1 at +0 to 4 at +30, 5 with its Mastery; 0 for a skill untrained or none. */
    max: number;
    /** The skill as the roll names it, "Deceive"; "" without one. */
    skill: string;
    /** Where the max comes from: "Max 3: Deceive +20", "Max 5: Mastery (Deceive)". */
    source: string;
    /** A Mastery without its skill in the talents while the skill could have it: how to name it. */
    hint: string | null;
    /** The roll names a skill the sheet no longer has, as a custom skill deleted since. */
    lost?: boolean;
}

/** The ePR a cast of the Sorcery spell at `powerPath` can take, by the level of the skill its roll is tested on. */
export function sorceryCap(state: SheetSignals, powerPath: string): SorceryCap {
    const stats = statsOf(state);
    const base = textAt(state, `${powerPath}.roll.skill`);
    const found = base ? findSkill(state, base) : null;
    if (!found) return { max: 0, skill: "", source: "", hint: null, lost: !!base };
    const skill = testBaseLabel(state, stats, base);
    const level = SKILL_ADVANCES.filter(key => found.skill[key]?.value).length;
    if (level === 0) return { max: 0, skill, source: `Max 0: ${skill} is not trained`, hint: null };
    const levelSource = { max: level, skill, source: `Max ${level}: ${skill} ${ADVANCE_LABELS[level]}`, hint: null };
    // Mastery needs the skill at +30.
    if (level < 4) return levelSource;

    const names = new Set(masteryNames(state, stats, base));
    const talents = talentNames(state);
    const mastery = talents.find(name => names.has(nameKey(name).match(MASTERY)?.[1] ?? ""));
    if (mastery) return { max: 5, skill, source: `Max 5: ${mastery}`, hint: null };
    const bare = talents.some(name => BARE_MASTERY.includes(nameKey(name)));
    return { ...levelSource, hint: bare ? `Name its skill: Mastery (${skill})` : null };
}

/** What a cast of the Sorcery spell at `powerPath` costs of its Focus: its Level, the level of the talent it is. */
export const sorceryCost = (state: SheetSignals, powerPath: string) => numberAt(state, `${powerPath}.level`);

const extra = (state: SheetSignals, rollPath: string, n: 1 | 2) =>
    (valueAt(state, `${rollPath}.extra${n}.enabled`) ? numberAt(state, `${rollPath}.extra${n}.value`) : 0);

/**
 * What a cast of the Sorcery spell at `powerPath` is tested against: its skill
 * in a psychic roll, the modifier, the extras and the penalty of two sustained
 * spells; no 5 per ePR. 0 without a skill.
 */
export function sorceryTotal(state: SheetSignals, powerPath: string): number {
    const rollPath = `${powerPath}.roll`;
    const test = sorceryTest(state, rollPath);
    if (!test) return 0;
    return getRollValue(state, test, "psychic") + numberAt(state, `${rollPath}.modifier`)
        + extra(state, rollPath, 1) + extra(state, rollPath, 2) + sorceryRecast(state, powerPath).penalty;
}
