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
        const result: TestAlternative = { skill: m[1].trim(), specs: [], specText: "", characteristics: [] };
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

/** A skill name as tests and the sheet are compared by: case, dashes and the spaces around parentheses ignored. */
const nameKey = (name: string) => name.toLowerCase().replace(/[-_\s]+/g, " ").replace(/\s*([()])\s*/g, "$1").trim();

/** The skills of the sheet a test can name, by their full name: "Charm", "Navigation (Surface)", "Trade (Musician)". */
function sheetSkills(state: SheetSignals, stats: StatSet): { base: string; key: string }[] {
    const skills = stats.skillsLeft.map(r => ({ base: r.key, key: nameKey(r.group ? `${r.group} (${r.label})` : r.label) }));
    for (const r of stats.skillsRight) {
        const typed = textAt(state, `skillsRight.${r.key}.name`).trim();
        if (!typed) continue;
        // A row of a group is named by its specialisation, "Musician", or whole, "Trade (Musician)".
        const whole = r.group && !nameKey(typed).startsWith(`${nameKey(r.group)}(`) ? `${r.group} (${typed})` : typed;
        skills.push({ base: r.key, key: nameKey(whole) });
    }
    for (const [id, skill] of Object.entries(state.customSkills?.list?.items ?? {})) {
        const name = skill.name?.value?.trim();
        if (name) skills.push({ base: CUSTOM_SKILL_PREFIX + id, key: nameKey(name) });
    }
    return skills;
}

export interface TestChoice {
    /** The skill of the roll: a row key or "custom:<id>". */
    skill: string;
    /** The characteristic of the roll, "" for the skill's own. */
    characteristic: string;
    /** "Musician (F)", "Navigation: Surface". */
    label: string;
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
                choices.push({ skill: base, characteristic, level, label: characteristic ? `${name} (${characteristic})` : name });
            }
        }
    }
    return { choices, missing };
}
