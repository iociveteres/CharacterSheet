// What a roll is tested against: a characteristic, a skill or a skill with
// another characteristic, as the base select of an attack or power names it.
import { characterState } from "./state";
import { skillDifficulty, skillRowName } from "./computed";
import { calculateBonusSuccesses, normalizeSkillName } from "../system";
import { CHARACTERISTIC_KEYS } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";

type Skill = SheetSignals["skillsLeft"][string] | SheetSignals["customSkills"]["list"]["items"][string];

/** The prefix of a custom skill's item id in a base select. */
export const CUSTOM_SKILL_PREFIX = "custom:";

/** "awareness (I)" gives { name: "awareness", charKey: "I" }; a plain name has no charKey. */
export function parseBase(baseSelect: string): { name: string; charKey: string | null } {
    const m = baseSelect.match(/^(.+?)\s*\(([A-Za-z]+)\)$/);
    return m ? { name: m[1].trim(), charKey: m[2] } : { name: baseSelect, charKey: null };
}

/**
 * The skill row or custom skill called `name`, with the name its skill_bonus
 * entries go by. Skill rows are found by their key, custom skills by
 * "custom:<item id>" or by name.
 */
function findSkill(name: string): { skill: Skill; name: string } | null {
    if (name.startsWith(CUSTOM_SKILL_PREFIX)) {
        const skill = characterState.customSkills?.list?.items?.[name.slice(CUSTOM_SKILL_PREFIX.length)];
        return skill ? { skill, name: skill.name.value } : null;
    }

    const key = name.toLowerCase().replace(/\s+/g, '-');
    for (const table of ['skillsLeft', 'skillsRight'] as const) {
        const skill = characterState[table]?.[key];
        if (skill) return { skill, name: skillRowName(skill, key) };
    }

    const wanted = normalizeSkillName(name);
    if (!wanted) return null;
    for (const skill of Object.values(characterState.customSkills?.list?.items ?? {})) {
        if (normalizeSkillName(skill.name?.value) === wanted) return { skill, name: skill.name.value };
    }
    return null;
}

/**
 * The value a roll on `baseSelect` is tested against. Reactive when read
 * inside a computed.
 */
export function getRollValue(baseSelect: string): number {
    if (!baseSelect) return 0;
    const { name, charKey } = parseBase(baseSelect);
    if (!charKey && CHARACTERISTIC_KEYS.includes(name)) {
        return characterState.characteristics?.[name]?.valueForRolls?.value ?? 0;
    }

    const found = findSkill(name);
    if (!found) return 0;
    return skillDifficulty(found.skill, charKey ?? (found.skill.characteristic?.value || "WS"), found.name);
}

/**
 * Bonus successes of a roll on `baseSelect`: a characteristic, a skill or a
 * skill with an overriding characteristic, e.g. "awareness (I)". A skill
 * gets them from the characteristic it is tested on.
 */
export function rollBonusSuccesses(baseSelect: string | null | undefined): number {
    const key = baseSelect ?? '';
    const unnaturalOf = (charKey: string) => characterState.characteristics?.[charKey]?.calculatedUnnatural?.value ?? 0;
    if (CHARACTERISTIC_KEYS.includes(key)) return calculateBonusSuccesses(unnaturalOf(key));

    const { name, charKey } = parseBase(key);
    const testedOn = charKey ?? findSkill(name)?.skill.characteristic?.value ?? null;
    return calculateBonusSuccesses(testedOn ? unnaturalOf(testedOn) : 0);
}
