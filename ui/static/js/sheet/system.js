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

/**
 * Resolve a stack expression against a stacks multiplier.
 *
 * Supported formats (case-insensitive):
 *   "10"        → 10
 *   "X"         → stacks
 *   "3X"        → stacks * 3
 *   "2X+5"      → stacks * 2 + 5
 *   "0.5X▲"     → Math.ceil(stacks * 0.5)       (round up)
 *   "0.5X▼"     → Math.floor(stacks * 0.5)      (round down, explicit)
 *   "0.5X▼+2"   → Math.floor(stacks * 0.5) + 2  (round down, explicit)
 *   "0.5X"      → Math.floor(stacks * 0.5)      (round down, default)
 *   ""  / null  → 0
 *
 * Use decimal fractions (0.5) instead of ½ etc.
 * Append ▲ to round up, ▼ or nothing to round down.
 *
 * @param {string|null|undefined} expr
 * @param {number} stacks - the condition's stack count (treat 0 as 1)
 * @returns {number}
 */
export function resolveStackExpr(expr, stacks = 1) {
    if (!expr && expr !== 0) return 0;
    // Normalize: collapse all whitespace so "2X▲ + 2" → "2X▲+2"
    const s = String(expr).trim().replace(/\s+/g, '');
    if (s === '') return 0;
    const n = stacks || 1;

    const round = (v, fn) => Number.isInteger(v) ? v : fn(v);

    // Plain number
    if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);

    // [coeff]X[▲▼]?[±additive]?
    const match = s.match(/^(-?\d*\.?\d*)X([▲▼])?([+-]\d+(\.\d+)?)?$/i);
    if (match) {
        const coeff = match[1] === '' ? 1 : match[1] === '-' ? -1 : parseFloat(match[1]);
        const roundFn = match[2] === '▲' ? Math.ceil : Math.floor; // default: floor
        const additive = match[3] ? parseFloat(match[3]) : 0;
        return round(coeff * n, roundFn) + additive;
    }

    // Fallback
    const fallback = parseFloat(s);
    return isNaN(fallback) ? 0 : fallback;
}