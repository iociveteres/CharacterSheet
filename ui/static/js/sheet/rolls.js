import { characterState } from "./state/state.js";

/**
 * Get the value and unnatural for a characteristic
 * Uses signals instead of CharacteristicBlock methods
 */
export function getCharacteristicData(charKey) {
    const char = characterState.characteristics?.[charKey];
    if (!char) {
        return { value: 0, unnatural: 0 };
    }
    return {
        value: char.calculatedValue.value,
        unnatural: char.calculatedUnnatural.value
    };
}

/**
 * Parse skill string to extract name and characteristic
 */
function parseSkillString(skillStr) {
    const match = skillStr.match(/^(.+?)\s*\(([A-Z]+)\)$/);
    if (match) {
        return {
            name: match[1].trim(),
            characteristic: match[2]
        };
    }
    return {
        name: skillStr.trim(),
        characteristic: null
    };
}


function initSkillRollClicks(root) {
    const skillsBlock = root.getElementById('skills');
    if (!skillsBlock) return;

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
        const charData = getCharacteristicData(charKey);
        const bonusSuccesses = Math.floor(charData.unnatural / 2);

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

function initCharacteristicRollClicks(root) {
    const characteristicsContainer = root.querySelector('.characteristics');
    if (!characteristicsContainer) return;

    const mainChars = characteristicsContainer.querySelector('.main-characteristics');
    if (!mainChars) return;

    mainChars.addEventListener('click', (event) => {
        const label = event.target.closest('label');
        if (!label) return;

        const charBlock = label.closest('.characteristic-block');
        if (!charBlock) return;

        const charKey = charBlock.dataset.id;
        const charData = getCharacteristicData(charKey);

        const target = charData.value;
        if (!target || target <= 0) return;

        const bonusSuccesses = Math.floor(charData.unnatural / 2);

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

/**
 * Initialize all roll click handlers
 * MODIFIED: No longer needs characteristicBlocks parameter
 */
export function initRolls(root) {
    initSkillRollClicks(root);
    initCharacteristicRollClicks(root);
    initInitiativeRollClicks(root);
}