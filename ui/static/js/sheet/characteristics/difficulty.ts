// What a test on a characteristic or skill counts besides the characteristic:
// skill advances, skill_bonus entries, fatigue, roll bonuses of a domain.
import { calculateSkillAdvancement, calculateTestDifficulty, normalizeSkillName, resolveStackExpr } from "../system";
import type { RollDomain } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { characteristicsOf, collectEntries, sumEntryField } from "../modifiers/entries";

type SkillRow = SheetSignals["skillsLeft"][string];
type CustomSkill = SheetSignals["customSkills"]["list"]["items"][string];

const num = (s: { value: unknown } | undefined) => Number(s?.value) || 0;

const FATIGUE_ALL = new Set(['WS', 'BS', 'S', 'A', 'I', 'P', 'W', 'F']);
const FATIGUE_MENTAL = new Set(['I', 'P', 'W', 'F']);
const FATIGUE_PHYSICAL = new Set(['WS', 'BS', 'S', 'A']);

/** What fatigue takes from the tests on the characteristic `key`: 10 while fatigued, as its mode picks them. */
export function fatiguePenalty(state: SheetSignals, key: string): number {
    if ((Number(state.fatigue?.fatigueCur?.value) || 0) <= 0) return 0;
    const mode = state.fatigue?.fatigueMode?.value ?? 'all';
    const affected =
        mode === 'mental' ? FATIGUE_MENTAL :
            mode === 'physical' ? FATIGUE_PHYSICAL :
                mode === 'nothing' ? null :
                    FATIGUE_ALL;
    return affected?.has(key) ? 10 : 0;
}

/**
 * What a roll of `domain` on the characteristic `charKey` adds to its
 * valueForRolls: the roll_bonus entries of the characteristic "only" for the
 * domain, less those "except" it, which valueForRolls counts.
 */
export function domainRollBonus(state: SheetSignals, charKey: string, domain: RollDomain): number {
    let total = 0;
    for (const { entry, stacks } of collectEntries(state, 'roll_bonus')) {
        const mode = entry.domainMode?.value;
        if (!mode || !entry.domains?.[domain]?.value || !characteristicsOf(state, entry.name?.value).keys.has(charKey)) continue;
        const bonus = resolveStackExpr(entry.rollBonus?.value, stacks);
        total += mode === 'only' ? bonus : -bonus;
    }
    return total;
}

const SKILL_ADVANCES = ['plus0', 'plus10', 'plus20', 'plus30'] as const;

/** The level of a skill by the advances taken: 0 untrained, 1 at +0 to 4 at +30. */
export const skillLevel = (skill: SkillRow | CustomSkill): number => SKILL_ADVANCES.filter(key => skill[key]?.value).length;

/**
 * The test difficulty of a skill row or custom skill tested on `charKey`: its
 * advances and misc bonus, and the skill_bonus entries named `name`.
 */
export function skillDifficulty(state: SheetSignals, skill: SkillRow | CustomSkill, charKey: string, name: string | undefined): number {
    const val = state.characteristics?.[charKey]?.valueForRolls?.value ?? 0;
    const advances = skillLevel(skill);
    const skillName = normalizeSkillName(name);
    const bonus = skillName
        ? sumEntryField(state, 'skill_bonus', 'skillBonus', e => normalizeSkillName(e.name?.value) === skillName)
        : 0;
    return calculateTestDifficulty(val, calculateSkillAdvancement(advances)) + num(skill.miscBonus) + bonus;
}

/** A skill row is named by its row key until the player names it (right-column rows). */
export const skillRowName = (skill: SkillRow, skillId: string): string => skill.name?.value?.trim() || skillId;
