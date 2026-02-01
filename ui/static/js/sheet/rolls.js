import {
    calculateBonusSuccesses
} from "./system.js"

import {
    getRoot
} from "./utils.js"

/**
 * Get the value and unnatural for a characteristic
 * @param {string} charKey - Characteristic key (e.g., 'WS', 'BS', 'S')
 * @param {Object} characteristicBlocks - Map of characteristic blocks
 * @returns {{value: number, unnatural: number}}
 */
export function getCharacteristicData(charKey, characteristicBlocks) {
    const charBlock = characteristicBlocks[charKey];
    if (!charBlock) {
        return { value: 0, unnatural: 0 };
    }
    return {
        value: charBlock.getValue(),
        unnatural: charBlock.getUnnatural()
    };
}

/**
 * Get the difficulty value for a skill
 * @param {string} skillName - Name of the skill
 * @returns {number}
 */
export function getSkillDifficulty(skillName) {
    const root = getRoot();

    // Check standard skills table
    const skillsBlock = root.getElementById('skills');
    if (skillsBlock) {
        const rows = skillsBlock.querySelectorAll('tr');
        for (const row of rows) {
            const nameCell = row.querySelector('td:first-child');
            if (nameCell && nameCell.textContent.trim() === skillName) {
                const difficultyInput = row.querySelector('input[data-id="difficulty"]');
                return parseInt(difficultyInput?.value, 10) || 0;
            }
        }
    }

    // Check custom skills
    const customSkillsBlock = root.getElementById('custom-skills');
    if (customSkillsBlock) {
        const customSkills = customSkillsBlock.querySelectorAll('.custom-skill');
        for (const skill of customSkills) {
            const nameInput = skill.querySelector('input[data-id="name"]');
            if (nameInput && nameInput.value.trim() === skillName) {
                const difficultyInput = skill.querySelector('input[data-id="difficulty"]');
                return parseInt(difficultyInput?.value, 10) || 0;
            }
        }
    }

    return 0;
}

/**
 * Get the characteristic key that governs a skill
 * @param {string} skillName - Name of the skill
 * @returns {string|null}
 */
export function getSkillCharacteristic(skillName) {
    const root = getRoot();

    // Check standard skills table
    const skillsBlock = root.getElementById('skills');
    if (skillsBlock) {
        const rows = skillsBlock.querySelectorAll('tr');
        for (const row of rows) {
            const nameCell = row.querySelector('td:first-child');
            if (nameCell && nameCell.textContent.trim() === skillName) {
                const charSelect = row.querySelector('select[data-id="characteristic"]');
                return charSelect?.value || null;
            }
        }
    }

    // Check custom skills
    const customSkillsBlock = root.getElementById('custom-skills');
    if (customSkillsBlock) {
        const customSkills = customSkillsBlock.querySelectorAll('.custom-skill');
        for (const skill of customSkills) {
            const nameInput = skill.querySelector('input[data-id="name"]');
            if (nameInput && nameInput.value.trim() === skillName) {
                const charSelect = skill.querySelector('select[data-id="characteristic"]');
                return charSelect?.value || null;
            }
        }
    }

    return null;
}

/**
 * Get base value and bonus successes for attack roll
 * @param {Element} rollContainer - The roll dropdown container
 * @param {Object} characteristicBlocks - Map of characteristic blocks
 * @returns {{baseValue: number, bonusSuccesses: number}}
 */
export function getAttackRollBase(rollContainer, characteristicBlocks) {
    const baseSelect = rollContainer.querySelector('[data-id="base-select"]');
    if (!baseSelect) {
        return { baseValue: 0, bonusSuccesses: 0 };
    }

    const selectedOption = baseSelect.options[baseSelect.selectedIndex];
    const type = selectedOption.dataset.type;
    const key = selectedOption.value;

    if (type === 'characteristic') {
        const data = getCharacteristicData(key, characteristicBlocks);
        return {
            baseValue: data.value,
            bonusSuccesses: calculateBonusSuccesses(data.unnatural)
        };
    } else if (type === 'skill') {
        const difficulty = getSkillDifficulty(key);
        const charKey = getSkillCharacteristic(key);
        const unnaturalValue = charKey ? getCharacteristicData(charKey, characteristicBlocks).unnatural : 0;
        return {
            baseValue: difficulty,
            bonusSuccesses: calculateBonusSuccesses(unnaturalValue)
        };
    }

    return { baseValue: 0, bonusSuccesses: 0 };
}

// Add this function to initialize skill roll clicks
function initSkillRollClicks(root, characteristicBlocks) {
    const skillsBlock = root.getElementById('skills');

    skillsBlock.addEventListener('click', (event) => {
        const difficultyInput = event.target;

        // Check if clicked element is a difficulty input
        if (!difficultyInput.matches('input[data-id="difficulty"]')) {
            return;
        }

        const row = difficultyInput.closest('tr, .custom-skill');
        if (!row) return;

        const target = parseInt(difficultyInput.value, 10);
        if (isNaN(target) || target <= 0) return;

        // Get characteristic type for this skill
        const charSelect = row.querySelector('select[data-id="characteristic"]');
        if (!charSelect) return;

        const charKey = charSelect.value;
        const charBlock = characteristicBlocks[charKey];
        if (!charBlock) return;

        // Get unnatural value for bonus successes
        const unnaturalValue = charBlock.getUnnatural();
        const bonusSuccesses = calculateBonusSuccesses(unnaturalValue);

        // Get skill name for label
        let skillName = '';
        const nameInput = row.querySelector('input[data-id="name"]');
        if (nameInput) {
            skillName = nameInput.value || '';
        } else {
            const labelCell = row.querySelector('td:first-child');
            if (labelCell) {
                skillName = labelCell.textContent.trim();
            }
        }

        // Emit event
        document.dispatchEvent(new CustomEvent('sheet:rollVersus', {
            bubbles: true,
            detail: {
                target: target,
                bonusSuccesses: bonusSuccesses,
                label: skillName
            }
        }));
    });

    // Mark difficulty inputs as rollable
    skillsBlock.querySelectorAll('input[data-id="difficulty"]').forEach(input => {
        input.classList.add('rollable');
    });
}

// Add this function to initialize characteristic roll clicks
function initCharacteristicRollClicks(root, characteristicBlocks) {
    const characteristicsContainer = root.querySelector('.characteristics');
    const mainChars = characteristicsContainer.querySelector('.main-characteristics');

    mainChars.addEventListener('click', (event) => {
        const label = event.target.closest('label');
        if (!label) return;

        const charBlock = label.closest('.characteristic-block');
        if (!charBlock) return;

        const charKey = charBlock.dataset.id;
        const charBlockInstance = characteristicBlocks[charKey];
        if (!charBlockInstance) return;

        const target = charBlockInstance.getValue();
        if (!target || target <= 0) return;

        const unnaturalValue = charBlockInstance.getUnnatural();
        const bonusSuccesses = calculateBonusSuccesses(unnaturalValue);

        // Get characteristic name from label
        const labelText = label.textContent.replace(/\s*\([^)]*\)/, '').trim();

        // Emit event
        document.dispatchEvent(new CustomEvent('sheet:rollVersus', {
            bubbles: true,
            detail: {
                target: target,
                bonusSuccesses: bonusSuccesses,
                label: labelText
            }
        }));
    });

    // Mark labels as rollable
    mainChars.querySelectorAll('.characteristic-block label').forEach(label => {
        label.classList.add('rollable');
    });
}

// Add this function to initialize initiative roll clicks
function initInitiativeRollClicks(root) {
    const initiativeSection = root.querySelector('[data-id="initiative"]');
    if (!initiativeSection) return;

    const initiativeInput = initiativeSection;
    const container = initiativeInput.closest('.layout-row');
    if (!container) return;

    const label = container.querySelector('label');
    if (!label) return;

    label.addEventListener('click', () => {
        const expression = initiativeInput.value.trim();
        if (!expression) return;

        // Emit event
        document.dispatchEvent(new CustomEvent('sheet:rollExact', {
            bubbles: true,
            detail: {
                expression: expression,
                label: 'Initiative'
            }
        }));
    });

    // Mark label as rollable
    label.classList.add('rollable');
}

export function initRolls(root, characteristicBlocks) {
    initSkillRollClicks(root, characteristicBlocks);
    initCharacteristicRollClicks(root, characteristicBlocks);
    initInitiativeRollClicks(root);
}
