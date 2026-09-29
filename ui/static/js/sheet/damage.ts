// Damage expressions of weapons and of the modifiers added to them: a sum of
// dice ("1d10"), numbers and references to the character ("S.b", "½WS.b▲",
// "2×bPR"). state/damage.ts gives the references their values.

export type DamageTerm =
    | { kind: "dice"; count: number; sides: number }
    | { kind: "flat"; value: number }
    | { kind: "ref"; ref: string; factor: number; roundUp: boolean; sign: 1 | -1 };

export interface ParsedDamage {
    terms: DamageTerm[];
    /** The terms that are none of the above, as typed. */
    invalid: string[];
}

/** The reference to the base psy rating. */
export const BASE_PR = "bPR";

const DICE = /^(\d*)d(\d+)$/i;
const FLAT = /^\d+$/;
// [factor][×]reference[▲▼]; the factor is ½, 1/2, 0.5 or 2.
const REF = /^(?:(½|\d+\/\d+|\d*\.\d+|\d+)[×x*]?)?(bPR|[a-z]+\.b)([▲▼])?$/i;

function parseFactor(s: string | undefined): number {
    if (!s) return 1;
    if (s === "½") return 0.5;
    const [a, b] = s.split("/");
    return b === undefined ? parseFloat(a) : parseInt(a, 10) / parseInt(b, 10);
}

function parseTerm(s: string, sign: 1 | -1, keys: ReadonlyMap<string, string>): DamageTerm | null {
    const dice = s.match(DICE);
    if (dice) {
        const count = dice[1] ? parseInt(dice[1], 10) : 1;
        const sides = parseInt(dice[2], 10);
        return count > 0 && sides > 0 ? { kind: "dice", count: sign * count, sides } : null;
    }
    if (FLAT.test(s)) return { kind: "flat", value: sign * parseInt(s, 10) };

    const ref = s.match(REF);
    if (!ref) return null;
    const factor = parseFactor(ref[1]);
    const name = ref[2].toUpperCase() === BASE_PR.toUpperCase() ? BASE_PR : keys.get(ref[2].slice(0, -2).toUpperCase());
    if (!name || !Number.isFinite(factor)) return null;
    return { kind: "ref", ref: name, factor, roundUp: ref[3] === "▲", sign };
}

/**
 * The terms of `text`, whose references name one of the characteristics
 * `keys` (case-insensitive) or bPR. Terms are separated by + and -; the
 * dashes of the rulebooks (–, −) are minuses too. Spaces do not count.
 */
export function parseDamage(text: string, keys: readonly string[]): ParsedDamage {
    const byUpper = new Map(keys.map(k => [k.toUpperCase(), k]));
    const terms: DamageTerm[] = [];
    const invalid: string[] = [];
    let sign: 1 | -1 = 1;
    // The signs are the odd parts. A sign without a term after it, as while
    // typing "1d10+", counts for nothing.
    text.replace(/[–—−]/g, "-").split(/([+-])/).forEach((part, i) => {
        if (i % 2 === 1) {
            if (part === "-") sign = sign === 1 ? -1 : 1;
            return;
        }
        const raw = part.trim();
        if (!raw) return;
        const term = parseTerm(raw.replace(/\s+/g, ""), sign, byUpper);
        if (term) terms.push(term);
        else invalid.push(raw);
        sign = 1;
    });
    return { terms, invalid };
}

/** Dice by their sides, in the order they come, and the sum of the rest. */
export interface DamageSum {
    dice: Map<number, number>;
    flat: number;
}

export const emptySum = (): DamageSum => ({ dice: new Map(), flat: 0 });

/** A reference's value times its factor, rounded down unless ▲. */
function refValue(term: Extract<DamageTerm, { kind: "ref" }>, valueOf: (ref: string) => number): number {
    // Rounded first so that e.g. ⅓ × 9 is 3, not 2.9999….
    const v = Math.round(term.factor * valueOf(term.ref) * 1e6) / 1e6;
    return term.sign * (term.roundUp ? Math.ceil(v) : Math.floor(v));
}

/** Adds `terms` to `sum`: dice of the same sides add up, "1d10" and "1d10" are "2d10". */
export function addTerms(sum: DamageSum, terms: readonly DamageTerm[], valueOf: (ref: string) => number): DamageSum {
    for (const term of terms) {
        if (term.kind === "dice") sum.dice.set(term.sides, (sum.dice.get(term.sides) ?? 0) + term.count);
        else sum.flat += term.kind === "flat" ? term.value : refValue(term, valueOf);
    }
    return sum;
}

/** "2d10+9", "1d10-1", "3"; "0" for nothing. */
export function formatSum({ dice, flat }: DamageSum): string {
    const parts = [...dice].filter(([, count]) => count !== 0).map(([sides, count]) => `${count}d${sides}`);
    if (flat !== 0 || parts.length === 0) parts.push(String(flat));
    return parts.map((p, i) => (i > 0 && !p.startsWith("-") ? `+${p}` : p)).join("");
}

/** What `terms` add to a damage: "+4", "-1", "+1d10+2". */
export function addedBy(terms: readonly DamageTerm[], valueOf: (ref: string) => number): string {
    const sum = formatSum(addTerms(emptySum(), terms, valueOf));
    return sum.startsWith("-") ? sum : `+${sum}`;
}

export interface DamageMod {
    expr: string;
    enabled: boolean;
}

export interface ResolvedDamage {
    /** What a roll sends: the damage with the modifiers, or the text as typed when it is no expression. */
    expression: string;
    /** The damage as shown: the expression and its alternative in brackets, as "1d10+6 [1d10+9]". */
    text: string;
    /** What each counted modifier adds, as "S.b +4" or "+1d10" for one without references. */
    parts: string[];
    /** Whether the base reads as an expression; only then do the modifiers count. */
    parsed: boolean;
}

/**
 * The damage `base` with the enabled `mods` whose expressions parse. A base
 * that does not parse ("Нет", "1d5–1R") stays as typed and takes no
 * modifiers. "A [B]" gives A the modifiers and B too; the roll is of A.
 */
export function resolveDamage(
    base: string,
    mods: readonly DamageMod[],
    keys: readonly string[],
    valueOf: (ref: string) => number,
): ResolvedDamage {
    const typed = base.trim();
    const asTyped = { expression: typed, text: typed, parts: [], parsed: false };
    const m = typed.match(/^([^[\]]*)(?:\[([^[\]]*)\])?$/);
    if (!m) return asTyped;
    const main = parseDamage(m[1], keys);
    if (main.invalid.length || main.terms.length === 0) return asTyped;

    const counted = mods
        .filter(mod => mod.enabled)
        .map(mod => ({ mod, parsed: parseDamage(mod.expr, keys) }))
        .filter(({ parsed }) => parsed.invalid.length === 0 && parsed.terms.length > 0);
    const withMods = (terms: readonly DamageTerm[]) => {
        const sum = addTerms(emptySum(), terms, valueOf);
        for (const { parsed } of counted) addTerms(sum, parsed.terms, valueOf);
        return formatSum(sum);
    };

    const expression = withMods(main.terms);
    let text = expression;
    if (m[2] !== undefined) {
        const alt = parseDamage(m[2], keys);
        const altText = alt.invalid.length || alt.terms.length === 0 ? m[2].trim() : withMods(alt.terms);
        text = `${expression} [${altText}]`;
    }
    const parts = counted.map(({ mod, parsed }) => {
        const added = addedBy(parsed.terms, valueOf);
        return parsed.terms.some(t => t.kind === "ref") ? `${mod.expr.trim()} ${added}` : added;
    });
    return { expression, text, parts, parsed: true };
}
