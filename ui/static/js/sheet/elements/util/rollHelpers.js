import { characterState } from "../../state/state.js";
import { calculateTestDifficulty, calculateSkillAdvancement, calculateBonusSuccesses } from "../../system.js";

/**
 * Generic function to get roll defaults from a script element
 * @param {string} scriptId - The ID of the script element
 * @returns {object} Parsed JSON object, or {} if not found
 */
function getRollDefaultContent(scriptId) {
    const script = document.getElementById(scriptId);
    if (script) {
        return JSON.parse(script.textContent);
    } else {
        console.error(`Roll defaults script not found: ${scriptId}`);
        return {};
    }
}
// Exported reference - starts null, gets populated on sheet load

export let rollDefaults = null;
/**
 * Initialize roll defaults from DOM. Call once after charactersheet_inserted event.
 */

export function initializeRollDefaults() {
    rollDefaults = Object.freeze({
        rangedAttack: Object.freeze(getRollDefaultContent('attack-default-roll-content-ranged')),
        meleeAttack: Object.freeze(getRollDefaultContent('attack-default-roll-content-melee')),
        psychicPower: Object.freeze(getRollDefaultContent('psychotest-default-roll-content')),
        techPower: Object.freeze(getRollDefaultContent('tech-power-default-roll-content')),
    });
}

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
            return characterState.characteristics[baseSelectValue]?.calculatedValue?.value ?? 0;
        }
    }

    const resolveSkill = (skill) => {
        if (!overrideChar) return skill.difficulty?.value ?? 0;
        const charVal = characterState.characteristics?.[overrideChar]
            ?.calculatedValue?.value ?? 0;
        let count = 0;
        if (skill.plus0?.value) count++;
        if (skill.plus10?.value) count++;
        if (skill.plus20?.value) count++;
        if (skill.plus30?.value) count++;
        return calculateTestDifficulty(charVal, calculateSkillAdvancement(count))
            + (Number(skill.miscBonus?.value) || 0);
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
 * Used in _handleRollClick for roll events.
 * Reads the select element and returns both the base value and bonus successes.
 * @param {Element} rollContainer
 * @returns {{baseValue: number, bonusSuccesses: number}}
 */
export function getRollFull(rollContainer) {
    const sel = rollContainer.querySelector('select[data-id="baseSelect"]');
    if (!sel) return { baseValue: 0, bonusSuccesses: 0 };

    const selectedOption = sel.options[sel.selectedIndex];
    const type = selectedOption?.dataset?.type;
    const key = sel.value;

    if (type === 'characteristic') {
        const char = characterState.characteristics?.[key];
        const value = char?.calculatedValue?.value ?? 0;
        const unnatural = char?.calculatedUnnatural?.value ?? 0;
        return {
            baseValue: value,
            bonusSuccesses: calculateBonusSuccesses(unnatural)
        };
    }

    if (type === 'skill') {
        const baseValue = getRollValue(key);

        // Bonus successes from the governing characteristic
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
            const skill = allSkills[normalized];
            charKey = skill?.characteristic?.value ?? null;
        }

        const unnatural = charKey
            ? (characterState.characteristics?.[charKey]?.calculatedUnnatural?.value ?? 0)
            : 0;

        return {
            baseValue,
            bonusSuccesses: calculateBonusSuccesses(unnatural)
        };
    }

    return { baseValue: 0, bonusSuccesses: 0 };
}

/**
 * Initialize rollable damage label
 * @param {Element} container - Container element with damage field
 * @param {string} sourceName - Name of the source (weapon/power name)
 */
export function initRollableDamage(container, sourceName) {
    const damageRow = container.querySelector('.layout-row.damage');
    if (!damageRow) return;

    const label = damageRow.querySelector('label');
    const input = damageRow.querySelector('input[data-id="damage"]');

    if (!label || !input) return;

    // Make label clickable
    label.classList.add('rollable');
    label.addEventListener('click', () => {
        const diceExpression = input.value.trim();
        if (!diceExpression) return;

        // Dispatch simple dice roll event
        document.dispatchEvent(new CustomEvent('sheet:rollExact', {
            bubbles: true,
            detail: {
                expression: diceExpression,
                label: sourceName()
            }
        }));
    });
}

export function initRollableRating(container) {
    const ratingRow = container.querySelector('.layout-row.name');
    if (!ratingRow) return;

    const labelEl = ratingRow.querySelector('label');
    if (!labelEl) return;

    labelEl.classList.add('rollable');
    labelEl.addEventListener('click', () => {
        const name = container.querySelector('[data-id="name"]')?.value?.trim() || '';
        const rating = container.querySelector('[data-id="rating"]')?.value?.trim() || '';
        const rollLabel = [name, rating].filter(Boolean).join(' ');

        document.dispatchEvent(new CustomEvent('sheet:rollExact', {
            bubbles: true,
            detail: { expression: 'd100', label: rollLabel }
        }));
    });
}