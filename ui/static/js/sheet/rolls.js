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
        row.dispatchEvent(new CustomEvent('sheet:rollVersus', {
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
        charBlock.dispatchEvent(new CustomEvent('sheet:rollVersus', {
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
        label.dispatchEvent(new CustomEvent('sheet:rollExact', {
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
