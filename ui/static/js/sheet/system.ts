// how skill advancement affects test difficulty
export function calculateSkillAdvancement(count: number): number {
    if (count == 0)
        return -20
    return (count - 1) * 10
}

export function calculateTestDifficulty(characteristicValue: number, skillAdvancement: number): number {
    return Math.min(characteristicValue, 100) + skillAdvancement
}

export function calculateCharacteristicBase(characteristicValue: number, unnaturalValue: number): number {
    return Math.floor(Math.min(characteristicValue, 100) / 10) + unnaturalValue
}

/** A bonus with its sign: "+3", "-2", "+0". */
export function signed(n: number): string {
    return n < 0 ? String(n) : `+${n}`;
}

export function calculateBonusSuccesses(unnaturalValue: number | string): number {
    return Math.floor((parseInt(String(unnaturalValue), 10) || 0) / 2);
}

/**
 * Parse defenseSectors string like "T+A1+L1+(A2+L2+H)"
 * Returns which body part IDs receive AP, split by always vs defensive-only.
 */
export function parseDefenseSectors(str: string | null | undefined, arm: string): { alwaysParts: Set<string>; defensiveParts: Set<string> } {
    const sameArm = arm === 'left' ? 'leftArm' : 'rightArm';
    const sameLeg = arm === 'left' ? 'leftLeg' : 'rightLeg';
    const otherArm = arm === 'left' ? 'rightArm' : 'leftArm';
    const otherLeg = arm === 'left' ? 'rightLeg' : 'leftLeg';

    const codeMap: { [code: string]: string } = { T: 'body', A1: sameArm, L1: sameLeg, A2: otherArm, L2: otherLeg, H: 'head' };

    const s = (str ?? '').replace(/\s/g, '');
    const alwaysParts = new Set<string>();
    const defensiveParts = new Set<string>();

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
 * @param stacks - the condition's stack count (treat 0 as 1)
 */
export function resolveStackExpr(expr: string | number | null | undefined, stacks = 1): number {
    if (!expr && expr !== 0) return 0;
    // Normalize: collapse all whitespace so "2X▲ + 2" → "2X▲+2"
    const s = String(expr).trim().replace(/\s+/g, '');
    if (s === '') return 0;
    const n = stacks || 1;

    const round = (v: number, fn: (x: number) => number) => Number.isInteger(v) ? v : fn(v);

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

/** The characteristics an entry's name picks; `invalid` holds the tokens that name none. */
export interface CharacteristicSet {
    keys: ReadonlySet<string>;
    invalid: string[];
}

/**
 * The characteristics of `keys` that a condition entry names: keys separated
 * by commas or spaces ("WS, BS"), Any for all of them and -KEY to leave one
 * out ("Any -T"). Exclusions alone start from Any. Case-insensitive. An
 * unknown token makes the name pick nothing: counting the rest could apply
 * the entry where the player did not mean it.
 */
export function parseCharacteristics(name: string | null | undefined, keys: readonly string[]): CharacteristicSet {
    const byUpper = new Map(keys.map(k => [k.toUpperCase(), k]));
    const include = new Set<string>();
    const exclude = new Set<string>();
    const invalid: string[] = [];
    let any = false;
    for (const token of (name ?? '').split(/[\s,]+/).filter(Boolean)) {
        const excluded = token.startsWith('-');
        const word = (excluded ? token.slice(1) : token).toUpperCase();
        if (!excluded && word === 'ANY') {
            any = true;
            continue;
        }
        const key = byUpper.get(word);
        if (!key) invalid.push(token);
        else (excluded ? exclude : include).add(key);
    }
    if (invalid.length) return { keys: new Set(), invalid };
    const picked = any || (include.size === 0 && exclude.size > 0) ? keys : [...include];
    return { keys: new Set(picked.filter(k => !exclude.has(k))), invalid };
}

export function normalizeSkillName(s: string | null | undefined): string {
    return (s ?? '').toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

/**
 * Checks whether a character's alignment (e.g. "Khorne (Vanguard)" or "Undivided")
 * satisfies a comma-separated requirement list that may specify god-only ("Khorne")
 * or god+path ("Khorne (Vanguard)") entries. Case-insensitive.
 */
export function alignmentMatches(charAlignment: string | null | undefined, requirementList: string | null | undefined): boolean {
    const charLower = (charAlignment ?? '').trim().toLowerCase();
    if (!charLower) return false;
    const charGod = charLower.split('(')[0].trim(); // "khorne (vanguard)" -> "khorne"

    const entries = (requirementList ?? '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    return entries.some(entry => entry === charLower || entry === charGod);
}
