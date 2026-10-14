// The Magic test of a spell as the wiki writes it («v магия ›
// недоспелкастинг»), "Charm(F) +0 или Trade(Bardic)(Стат Навыка) +0 vs W +0":
// its alternatives, each a skill with the specialisations it may be in and the
// characteristics it may be tested on, and the skills of the sheet each can be
// cast on. The roll of a Sorcery spell offers them (SorceryRoll.tsx); a test
// it cannot read offers nothing.
import { SKILL_ADVANCES } from "./computed";
import { CUSTOM_SKILL_PREFIX, findSkill } from "./rollBase";
import { statsOf } from "./state";
import { textAt } from "./sync";
import { testBaseLabel } from "./testOptions";
import type { StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

export interface TestAlternative {
    /** "Trade", "Charm", "Navigation". */
    skill: string;
    /** The specialisations it may be in, a family expanded: Dancer, Musician…; none for a skill without them. */
    specs: string[];
    /** The specialisations as the test writes them, "Bardic"; "" without. */
    specText: string;
    /** The characteristics it may be tested on, "" for the skill's own; none when the test names none. */
    characteristics: string[];
    /** The modifier written after it, 0 without one; null for one that is not a single number, "+20/-20". */
    modifier: number | null;
}

/** Splits `text` at `sep`, a sticky pattern, outside parentheses. */
function splitOutside(text: string, sep: RegExp): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth = Math.max(0, depth - 1);
        else if (depth === 0) {
            sep.lastIndex = i;
            const m = sep.exec(text);
            if (!m) continue;
            parts.push(text.slice(start, i));
            start = i + m[0].length;
            i = start - 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map(p => p.trim()).filter(Boolean);
}

const VERSUS = /\s+vs\.?\s+/iy;
const OR = /\s+(?:или|or)\s+/iy;
// "+0", "-10", "+20/-20", glued to the name or not.
const MODIFIER = /\s*[+\-−–]\s*\d[\d\s/+\-−–]*$/;
const LIST_SEPARATOR = /\s*,\s*|\s+(?:или|or)\s+/i;
// What the wiki calls the skill's own characteristic.
const OWN = ["стат навыка", "skill's own", "skill stat"];

/** The modifier `written` after a skill, as TestAlternative.modifier reads it. */
function modifierOf(written: string | undefined): number | null {
    if (!written) return 0;
    const m = written.replace(/[−–]/g, "-").replace(/\s+/g, "").match(/^[+-]\d+$/);
    return m ? parseInt(m[0], 10) : null;
}

/** The alternatives of the Magic test `text` of the kind of `stats`; none it cannot read. */
export function parseMagicTest(text: string, stats: StatSet): TestAlternative[] {
    const ours = splitOutside(text, VERSUS)[0] ?? "";
    const characteristic = (token: string) => {
        if (OWN.includes(token.toLowerCase())) return "";
        return stats.skillCharacteristics.find(c => c.toLowerCase() === token.toLowerCase()) ?? null;
    };
    const family = (spec: string) =>
        Object.entries(stats.skillFamilies).find(([name]) => name.toLowerCase() === spec.toLowerCase())?.[1] ?? [spec];

    return splitOutside(ours, OR).flatMap(alternative => {
        // A skill is written with its characteristics in parentheses: free text is no test.
        const m = alternative.replace(MODIFIER, "").match(/^([^()]+?)\s*((?:\([^()]*\)\s*)+)$/);
        if (!m) return [];
        const result: TestAlternative = {
            skill: m[1].trim(), specs: [], specText: "", characteristics: [], modifier: modifierOf(alternative.match(MODIFIER)?.[0]),
        };
        for (const [, group] of m[2].matchAll(/\(([^()]*)\)/g)) {
            const tokens = group.split(LIST_SEPARATOR).map(t => t.trim()).filter(Boolean);
            const characteristics = tokens.map(characteristic);
            if (characteristics.every(c => c !== null)) result.characteristics = characteristics as string[];
            else if (!result.specText) {
                result.specText = group.trim();
                result.specs = tokens.flatMap(family);
            }
        }
        return [result];
    });
}

/** A skill or talent name as tests, talents and the sheet are compared by: case, dashes and the spaces around parentheses ignored. */
export const nameKey = (name: string) => name.toLowerCase().replace(/[-_\s]+/g, " ").replace(/\s*([()])\s*/g, "$1").trim();

/**
 * The full name of the skill `base` of the sheet, as a Magic test or a
 * Mastery writes it: "Charm", "Navigation (Surface)", "Trade (Musician)"; ""
 * for a right-column row or custom skill not named.
 */
export function skillFullName(state: SheetSignals, stats: StatSet, base: string): string {
    if (base.startsWith(CUSTOM_SKILL_PREFIX)) {
        return state.customSkills?.list?.items?.[base.slice(CUSTOM_SKILL_PREFIX.length)]?.name?.value?.trim() ?? "";
    }
    const left = stats.skillsLeft.find(r => r.key === base);
    if (left) return left.group ? `${left.group} (${left.label})` : left.label;
    const group = stats.skillsRight.find(r => r.key === base)?.group;
    const typed = textAt(state, `skillsRight.${base}.name`).trim();
    // A row of a group is named by its specialisation, "Musician", or whole, "Trade (Musician)".
    return typed && group && !nameKey(typed).startsWith(`${nameKey(group)}(`) ? `${group} (${typed})` : typed;
}

/** The skills of the sheet a test can name, by the key of their full name. */
function sheetSkills(state: SheetSignals, stats: StatSet): { base: string; key: string }[] {
    const bases = [
        ...stats.skillsLeft.map(r => r.key),
        ...stats.skillsRight.map(r => r.key),
        ...Object.keys(state.customSkills?.list?.items ?? {}).map(id => CUSTOM_SKILL_PREFIX + id),
    ];
    return bases.flatMap(base => {
        const name = skillFullName(state, stats, base);
        return name ? [{ base, key: nameKey(name) }] : [];
    });
}

export interface TestChoice {
    /** The skill of the roll: a row key or "custom:<id>". */
    skill: string;
    /** The characteristic of the roll, "" for the skill's own. */
    characteristic: string;
    /** "Musician (F)", "Navigation: Surface". */
    label: string;
    /** The modifier of its alternative; null when the test does not give one number. */
    modifier: number | null;
    /** Its advances: 0 untrained to 4 at +30. */
    level: number;
}

export interface MagicTestChoices {
    /** The skills of the sheet the test can be cast on, each with a characteristic the test allows, in its order. */
    choices: TestChoice[];
    /** The alternatives the sheet has no skill for, as a hint names them: "Trade (Bardic): Dancer, Musician, Orator or Soothsayer". */
    missing: string[];
}

const listed = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0] ?? "");

/** What the Magic test of the spell at `powerPath` can be cast on. */
export function magicTestChoices(state: SheetSignals, powerPath: string): MagicTestChoices {
    const stats = statsOf(state);
    const skills = sheetSkills(state, stats);
    const choices: TestChoice[] = [];
    const missing: string[] = [];
    for (const alternative of parseMagicTest(textAt(state, `${powerPath}.psychotest`), stats)) {
        const { skill, specs, specText } = alternative;
        const wanted = new Set((specs.length ? specs.map(s => `${skill} (${s})`) : [skill]).map(nameKey));
        const found = skills.filter(s => wanted.has(s.key));
        if (!found.length) {
            const named = specText ? `${skill} (${specText})` : skill;
            missing.push(specs.length > 1 ? `${named}: ${listed(specs)}` : named);
            continue;
        }
        for (const { base } of found) {
            const level = SKILL_ADVANCES.filter(key => findSkill(state, base)?.skill[key]?.value).length;
            const name = testBaseLabel(state, stats, base);
            for (const characteristic of alternative.characteristics.length ? alternative.characteristics : [""]) {
                if (choices.some(c => c.skill === base && c.characteristic === characteristic)) continue;
                choices.push({ skill: base, characteristic, level, label: characteristic ? `${name} (${characteristic})` : name, modifier: alternative.modifier });
            }
        }
    }
    return { choices, missing };
}
