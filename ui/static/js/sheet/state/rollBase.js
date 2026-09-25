// What a roll is tested against: a characteristic, a skill or a skill with
// another characteristic, as the base select of an attack or power names it.
import { characterState } from "./state.js";
import { calculateTestDifficulty, calculateSkillAdvancement, calculateBonusSuccesses } from "../system.js";
import { CHARACTERISTIC_KEYS } from "../schema/constants";

/**
 * Used inside computed(() => ...) for reactive totals.
 * @param {string} baseSelectValue - The value of the baseSelect input
 * @returns {number}
 */
export function getRollValue(baseSelectValue) {
    if (!baseSelectValue) return 0;

    const overrideMatch = baseSelectValue.match(/^(.+?)\s*\(([A-Za-z]+)\)$/);
    const lookupName = overrideMatch ? overrideMatch[1].trim() : baseSelectValue;
    const overrideChar = overrideMatch ? overrideMatch[2] : null;

    // Plain characteristic (no override)
    if (!overrideChar) {
        const charKeys = ["WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Inf", "Cor"];
        if (charKeys.includes(baseSelectValue)) {
            return characterState.characteristics[baseSelectValue]?.valueForRolls?.value ?? 0;
        }
    }

    const resolveSkill = (skill) => {
        if (!overrideChar) {
            // skill.difficulty already incorporates skill_bonus via computed.js
            return skill.difficulty?.value ?? 0;
        }
        // Override characteristic: recompute from scratch using valueForRolls
        const charVal = characterState.characteristics?.[overrideChar]
            ?.valueForRolls?.value ?? 0;                          // ← was calculatedValue
        let count = 0;
        if (skill.plus0?.value) count++;
        if (skill.plus10?.value) count++;
        if (skill.plus20?.value) count++;
        if (skill.plus30?.value) count++;

        // Skill bonus from conditions (skill_bonus type, matched by skill name)
        const skillName = (skill.name?.value ?? lookupName).toLowerCase();
        let skillCondBonus = 0;
        for (const cond of Object.values(characterState.conditions?.list?.items ?? {})) {
            if (!cond.enabled?.value) continue;
            for (const entry of Object.values(cond.entries?.items ?? {})) {
                if (entry.type?.value !== 'skill_bonus') continue;
                if ((entry.name?.value ?? '').toLowerCase() !== skillName) continue;
                skillCondBonus += parseInt(entry.skillBonus?.value, 10) || 0;
            }
        }

        return calculateTestDifficulty(charVal, calculateSkillAdvancement(count))
            + (Number(skill.miscBonus?.value) || 0)
            + skillCondBonus;
    };

    const normalized = lookupName.toLowerCase().replace(/\s+/g, '-');

    for (const [id, skill] of Object.entries(characterState.skillsLeft ?? {})) {
        if (id === normalized) return resolveSkill(skill);
    }
    for (const [id, skill] of Object.entries(characterState.skillsRight ?? {})) {
        if (id === normalized) return resolveSkill(skill);
    }
    for (const skill of Object.values(characterState.customSkills?.items ?? {})) {
        if (skill.name?.value?.toLowerCase() === lookupName.toLowerCase()) {
            return resolveSkill(skill);
        }
    }

    return 0;
}

/**
 * Bonus successes of a roll on `baseSelect`: a characteristic, a skill or a
 * skill with an overriding characteristic, e.g. "awareness (I)". A skill
 * gets them from the characteristic it is tested on.
 * @param {string} baseSelect
 * @returns {number}
 */
export function rollBonusSuccesses(baseSelect) {
    const key = baseSelect ?? '';
    const unnaturalOf = charKey => characterState.characteristics?.[charKey]?.calculatedUnnatural?.value ?? 0;
    if (CHARACTERISTIC_KEYS.includes(key)) return calculateBonusSuccesses(unnaturalOf(key));

    const overrideMatch = key.match(/^(.+?)\s*\(([A-Za-z]+)\)$/);
    let charKey = overrideMatch ? overrideMatch[2] : null;

    if (!charKey) {
        const normalized = key.toLowerCase().replace(/\s+/g, '-');
        const allSkills = {
            ...characterState.skillsLeft,
            ...characterState.skillsRight,
            ...Object.fromEntries(
                Object.values(characterState.customSkills?.items ?? {})
                    .map(s => [s.name?.value?.toLowerCase(), s])
            )
        };
        charKey = allSkills[normalized]?.characteristic?.value ?? null;
    }

    return calculateBonusSuccesses(charKey ? unnaturalOf(charKey) : 0);
}
