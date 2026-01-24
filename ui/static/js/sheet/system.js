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
    const unnatural = parseInt(unnaturalValue, 10) || 0;
    return Math.floor(unnatural / 2);
}
