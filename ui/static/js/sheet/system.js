// how skill advancement affects test difficulty
export function calculateSkillAdvancement(count) {
    if (count == 0)
        return -20
    return (count - 1) * 10
}

export function calculateTestDifficulty(characteristicValue, skillAdvancement) {
    return Math.min(characteristicValue, 100) + skillAdvancement
}

export function calculateCharacteristicBase(characteristicValue, unnaturalValue) {
    return Math.floor(Math.min(characteristicValue, 100) / 10) + unnaturalValue
}

export function calculateDamageAbsorption(
    toughnessBase,
    armourValue,
    naturalArmourVal,
    daemonicVal,
    machineVal,
    otherArmourVal
) {
    return toughnessBase + armourValue + naturalArmourVal + daemonicVal + machineVal + otherArmourVal;
}

export function calculateBonusSuccesses(unnaturalValue) {
    return Math.floor((parseInt(unnaturalValue, 10) || 0) / 2);
}

/**
 * Parse defenseSectors string like "T+A1+L1+(A2+L2+H)"
 * Returns which body part IDs receive AP, split by always vs defensive-only.
 */
export function parseDefenseSectors(str, arm) {
    const sameArm = arm === 'left' ? 'leftArm' : 'rightArm';
    const sameLeg = arm === 'left' ? 'leftLeg' : 'rightLeg';
    const otherArm = arm === 'left' ? 'rightArm' : 'leftArm';
    const otherLeg = arm === 'left' ? 'rightLeg' : 'leftLeg';

    const codeMap = { T: 'body', A1: sameArm, L1: sameLeg, A2: otherArm, L2: otherLeg, H: 'head' };

    const s = (str ?? '').replace(/\s/g, '');
    const alwaysParts = new Set();
    const defensiveParts = new Set();

    for (const match of s.matchAll(/\(([^)]+)\)/g)) {
        for (const code of match[1].split('+')) {
            const part = codeMap[code];
            if (part) defensiveParts.add(part);
        }
    }
    for (const code of s.replace(/\([^)]+\)/g, '').split('+').filter(Boolean)) {
        const part = codeMap[code];
        if (part) alwaysParts.add(part);
    }

    return { alwaysParts, defensiveParts };
}