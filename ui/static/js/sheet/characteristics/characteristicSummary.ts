// What makes up a characteristic and a skill's difficulty, line by line, for
// their titles (components/hoverTitle.ts); the values counted as
// characteristicComputeds.ts counts them, each entry named by its condition or item.
import { ROLL_DOMAINS } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { calculateSkillAdvancement, fatiguePenalty, skillRowName } from "./difficulty";
import { normalizeSkillName } from "./skillNames";
import { resolveStackExpr } from "../modifiers/entryValues";
import { signed } from "../components/format";
import { characteristicCaps } from "./caps";
import { characteristicsOf, collectEntries, type Entry, type EntryRef } from "../modifiers/entries";
import { resolvePath } from "../core/sync";

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
export const addedLines = (refs: readonly EntryRef[], field: EntryField) =>
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
        ...addedLines(entriesOn(state, "char_bonus", key), "bonus"),
        ...characteristicCaps(state, key).map(cap => `${sourceName(cap.ref)}: at most ${cap.total}${cap.raises.length
            ? ` (${[cap.base, ...cap.raises.map(r => `${signed(r.value)} ${r.source}`)].join(" ")})`
            : ""}`),
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
        ...addedLines(entriesOn(state, "char_bonus", key), "unnaturalBonus"),
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
        ...addedLines(bonuses, "skillBonus"),
    ];
}
