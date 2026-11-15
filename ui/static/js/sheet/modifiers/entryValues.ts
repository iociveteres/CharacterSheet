// How the fields of an entry read: a value as a stack expression of the
// condition's stacks, a name as the characteristics it picks.

const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
// [coeff]X[▲▼]?[±additive]?
const STACK_TERM = /^(-?\d*\.?\d*)X([▲▼])?([+-]\d+(\.\d+)?)?$/i;

/** Whether resolveStackExpr reads `expr` as a number or a stack expression; "½WS.b▲" and "1d10" it does not. */
export function isStackExpr(expr: string | number | null | undefined): boolean {
    const s = String(expr ?? '').replace(/\s+/g, '');
    return s === '' || PLAIN_NUMBER.test(s) || STACK_TERM.test(s);
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

    if (PLAIN_NUMBER.test(s)) return parseFloat(s);

    const match = s.match(STACK_TERM);
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
 * by commas or spaces ("WS, BS"), Any for `anyKeys` and -KEY to leave one out
 * ("Any -T"). Exclusions alone start from Any. Case-insensitive. An unknown
 * token makes the name pick nothing: counting the rest could apply the entry
 * where the player did not mean it.
 */
export function parseCharacteristics(
    name: string | null | undefined,
    keys: readonly string[],
    anyKeys: readonly string[] = keys,
): CharacteristicSet {
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
    const picked = any || (include.size === 0 && exclude.size > 0) ? [...anyKeys, ...include] : [...include];
    return { keys: new Set(picked.filter(k => !exclude.has(k))), invalid };
}
