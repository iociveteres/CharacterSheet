// What makes up a characteristic, a skill's difficulty and the movement, line
// by line, for their titles (components/hoverTitle.ts); the values counted as
// state/computed.ts counts them, each entry named by its condition or item.
import { ROLL_DOMAINS } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { calculateSkillAdvancement, normalizeSkillName, resolveStackExpr, signed } from "../system";
import { MOVEMENT_REFS, addTerms, emptySum, parseDamage } from "../damage";
import { characteristicKeys } from "./characteristics";
import { characteristicsOf, collectEntries, fatiguePenalty, skillRowName, type Entry, type EntryRef } from "./computed";
import { MIN_SPD, conditionsSpd, modeDistance, modeMult, modeName, modeSpd, movementRefValue, spdProblem, spdValue, type MoveColumn } from "./movement";
import { resolvePath, textAt } from "./sync";

type EntryField = Exclude<keyof Entry, "type" | "domains">;
type SkillRow = SheetSignals["skillsLeft"][string];
type CustomSkill = SheetSignals["customSkills"]["list"]["items"][string];

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;
const sourceName = ({ source }: EntryRef) => String(source.name?.value || "—");
const valueOf = ({ entry, stacks }: EntryRef, field: EntryField) => resolveStackExpr(entry[field]?.value, stacks);

/** The entries of `type` that name the characteristic `key`. */
const entriesOn = (state: SheetSignals, type: string, key: string) =>
    collectEntries(state, type, e => characteristicsOf(state, e.name?.value).keys.has(key));

/** "Rage +10" for each entry whose `field` adds something. */
const added = (refs: readonly EntryRef[], field: EntryField) =>
    refs.flatMap(ref => (valueOf(ref, field) ? [`${sourceName(ref)} ${signed(valueOf(ref, field))}`] : []));

/** What sets `field` in place of the permanent value: the highest override that fills it. */
function override(refs: readonly EntryRef[], field: EntryField): string | null {
    let best: { ref: EntryRef; value: number } | null = null;
    for (const ref of refs) {
        if (String(ref.entry[field]?.value ?? "").trim() === "") continue;
        const value = valueOf(ref, field);
        if (!best || value > best.value) best = { ref, value };
    }
    return best && `${sourceName(best.ref)} sets ${best.value}`;
}

/** The rolls a roll bonus of a mode counts in, as "only Ranged, Psy". */
function domainsOf({ entry }: EntryRef): string {
    const mode = entry.domainMode?.value;
    const domains = ROLL_DOMAINS.filter(d => entry.domains?.[d.value]?.value).map(d => d.label);
    return mode && domains.length ? `, ${mode === "only" ? "only" : "not"} on ${domains.join(", ")}` : "";
}

/**
 * What the tests on `key` add to its value: fatigue and the roll bonuses; an
 * ordinary test, as of a skill, counts no bonus "only" for some rolls.
 */
function testLines(state: SheetSignals, key: string, ordinary: boolean): string[] {
    const fatigue = fatiguePenalty(state, key);
    const rolls = entriesOn(state, "roll_bonus", key)
        .filter(ref => valueOf(ref, "rollBonus") && !(ordinary && ref.entry.domainMode?.value === "only"));
    return [
        ...(fatigue ? [`Fatigue ${signed(-fatigue)}`] : []),
        ...rolls.map(ref => `${sourceName(ref)} ${signed(valueOf(ref, "rollBonus"))}${domainsOf(ref)}`),
    ];
}

/** The characteristic `key`: its permanent value or override, the bonuses and caps, then what its tests add. */
export function characteristicSummary(state: SheetSignals, key: string): string[] {
    const char = state.characteristics?.[key];
    if (!char) return [];
    const tests = testLines(state, key, false);
    return [
        `${key} ${char.calculatedValue.value}`,
        override(entriesOn(state, "char_override", key), "overrideValue") ?? `Permanent ${num(char.value)}`,
        ...added(entriesOn(state, "char_bonus", key), "bonus"),
        ...entriesOn(state, "char_cap", key).flatMap(ref => (valueOf(ref, "cap") > 0 ? [`${sourceName(ref)}: at most ${valueOf(ref, "cap")}`] : [])),
        ...(tests.length ? [`Tests at ${char.valueForRolls.value}:`, ...tests] : []),
    ];
}

/** The unnatural characteristic `key` and the successes it adds. */
export function unnaturalSummary(state: SheetSignals, key: string): string[] {
    const char = state.characteristics?.[key];
    if (!char) return [];
    const successes = num(char.bonusSuccesses);
    return [
        `Unnatural ${key} ${char.calculatedUnnatural.value}${successes ? `: ${signed(successes)} success${successes === 1 ? "" : "es"} on a passed test` : ""}`,
        override(entriesOn(state, "char_override", key), "overrideUnnatural") ?? `Permanent ${num(char.unnatural)}`,
        ...added(entriesOn(state, "char_bonus", key), "unnaturalBonus"),
    ];
}

/** The difficulty of the skill row or custom skill at `rowPath`, as skillDifficulty counts it. */
export function skillSummary(state: SheetSignals, rowPath: string): string[] {
    const skill = resolvePath(state, rowPath) as SkillRow | CustomSkill | undefined;
    if (!skill) return [];
    const name = rowPath.startsWith("customSkills.") ? skill.name?.value : skillRowName(skill as SkillRow, rowPath.slice(rowPath.lastIndexOf(".") + 1));
    const charKey = skill.characteristic?.value || "WS";
    const char = state.characteristics?.[charKey];
    const value = num(char?.valueForRolls);
    const advances = (["plus0", "plus10", "plus20", "plus30"] as const).filter(k => skill[k]?.value).length;
    const skillName = normalizeSkillName(name);
    const bonuses = skillName ? collectEntries(state, "skill_bonus", e => normalizeSkillName(e.name?.value) === skillName) : [];
    return [
        `Difficulty ${num(skill.difficulty)}`,
        `${charKey} ${num(char?.calculatedValue)}`,
        ...testLines(state, charKey, true),
        // calculateTestDifficulty counts no more than 100.
        ...(value > 100 ? [`Counts 100 of ${value}`] : []),
        `${advances ? "Advances" : "Untrained"} ${signed(calculateSkillAdvancement(advances))}`,
        ...(num(skill.miscBonus) ? [`Misc ${signed(num(skill.miscBonus))}`] : []),
        ...added(bonuses, "skillBonus"),
    ];
}

/** The terms of `expr` with what each adds: "A.b +3", "Size +1", "+2" for a number; those adding 0 left out, as Size 0. */
function termLines(state: SheetSignals, expr: string): string[] {
    const keys = characteristicKeys(state);
    let sign = "";
    return expr.replace(/[–—−]/g, "-").split(/([+-])/).flatMap((part, i) => {
        if (i % 2 === 1) {
            sign = part === "-" ? (sign === "-" ? "" : "-") : sign;
            return [];
        }
        const term = part.trim();
        if (!term) return [];
        const own = sign;
        sign = "";
        const { terms } = parseDamage(`${own}${term}`, keys, MOVEMENT_REFS);
        const value = addTerms(emptySum(), terms, ref => movementRefValue(state, ref)).flat;
        if (value === 0) return [];
        return [terms.some(t => t.kind === "ref") ? `${term} ${signed(value)}` : signed(value)];
    });
}

/**
 * What makes up the distance of `column` of the mode at `modePath`, line by
 * line for its title: the SPD times the multiplier, the terms of the SPD and
 * what the conditions add, each named by its condition or item.
 */
export function movementSummary(state: SheetSignals, modePath: string, column: MoveColumn): string[] {
    const header = `${modeName(state, modePath)}: ${column.label} ${modeDistance(state, modePath, column)}`;
    const expr = textAt(state, `${modePath}.spd`);
    const problem = spdProblem(state, expr);
    if (problem) return [header, `${problem}. Set the SPD under ⚙`];

    const spd = modeSpd(state, modePath)!;
    const mult = modeMult(state, modePath, column);
    const raw = spdValue(state, expr)! + conditionsSpd(state);
    const terms = termLines(state, expr);
    const conditions = added(collectEntries(state, "movement_bonus"), "movementBonus");
    return [
        header,
        ...(mult !== 1 ? [`SPD ${spd} × ${mult}`] : []),
        // A lone number, as "6" of Flyer (6), is the SPD itself.
        ...(terms.length === 1 && !conditions.length && /^[+-]?\d/.test(terms[0]) ? [] : terms),
        ...conditions,
        ...(raw !== spd ? [`SPD ${raw} counts as ${MIN_SPD}`] : []),
    ];
}
