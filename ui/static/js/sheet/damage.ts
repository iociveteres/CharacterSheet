// Damage expressions of weapons and of the modifiers added to them: a sum of
// dice ("1d10", "PRd10"), numbers and references to the character ("S.b",
// "½WS.b▲", "2×bPR"). Penetration takes the same. state/damage.ts gives the
// references their values.

/** A reference times a factor, rounded down unless `roundUp`. */
interface RefPart {
    ref: string;
    factor: number;
    roundUp: boolean;
    sign: 1 | -1;
}

export type DamageTerm =
    | { kind: "dice"; count: number; sides: number }
    | { kind: "flat"; value: number }
    | ({ kind: "ref" } & RefPart)
    /** Dice as many as the reference, as "PRd10" or "½PR▲d10". */
    | ({ kind: "refDice"; sides: number } & RefPart);

export interface ParsedDamage {
    terms: DamageTerm[];
    /** The terms that are none of the above, as typed. */
    invalid: string[];
}

/** The reference to the base psy rating. */
export const BASE_PR = "bPR";
/** The reference to the psy rating a psychic power was manifested at. */
export const POWER_PR = "PR";

/** The reference to the size of the character, which a movement mode's SPD can hold. */
export const SIZE = "Size";

/** The references by name a weapon's damage can hold. */
export const WEAPON_REFS: readonly string[] = [BASE_PR];
/** The references by name a psychic power's damage can hold. */
export const POWER_REFS: readonly string[] = [BASE_PR, POWER_PR];
/** The references by name the SPD of a movement mode can hold. */
export const MOVEMENT_REFS: readonly string[] = [SIZE];

const DICE = /^(\d*)d(\d+)$/i;
const FLAT = /^\d+$/;
// [factor][×]reference[▲▼][×factor][dN]; a factor is ½, 1/2, 0.5 or 2. The
// rulebooks put it after the reference in ranges: "S.b×10".
const REF = /^(?:(½|\d+\/\d+|\d*\.\d+|\d+)[×x*]?)?(bPR|PR|Size|[a-z]+\.b)([▲▼])?(?:[×x*](½|\d+\/\d+|\d*\.\d+|\d+))?(?:d(\d+))?$/i;
// The rounding as the rulebooks write it: "½PR (окр.▲)".
const ROUNDING = /\(\s*окр\.?\s*([▲▼])\s*\)/gi;

/** A factor as the rulebooks write it: ½, 1/2, 0.5 or 2; 1 for none. */
export function parseFactor(s: string | undefined): number {
    if (!s) return 1;
    if (s === "½") return 0.5;
    const [a, b] = s.split("/");
    return b === undefined ? parseFloat(a) : parseInt(a, 10) / parseInt(b, 10);
}

// "×2", "×1.5▲", "x½": a multiplier, rounded down unless ▲.
const MULTIPLIER = /^[×x*]\s*(½|\d+\/\d+|\d*\.\d+|\d+)\s*([▲▼])?$/i;

/** What `text` multiplies by, as a range modifier or a weapon entry's value writes it; null when it is no "×n". */
export function readMultiplier(text: string): { factor: number; roundUp: boolean } | null {
    const m = text.trim().match(MULTIPLIER);
    if (!m) return null;
    const factor = parseFactor(m[1]);
    return Number.isFinite(factor) ? { factor, roundUp: m[2] === "▲" } : null;
}

function parseTerm(s: string, sign: 1 | -1, keys: ReadonlyMap<string, string>, named: readonly string[]): DamageTerm | null {
    const dice = s.match(DICE);
    if (dice) {
        const count = dice[1] ? parseInt(dice[1], 10) : 1;
        const sides = parseInt(dice[2], 10);
        return count > 0 && sides > 0 ? { kind: "dice", count: sign * count, sides } : null;
    }
    if (FLAT.test(s)) return { kind: "flat", value: sign * parseInt(s, 10) };

    const ref = s.match(REF);
    if (!ref) return null;
    const factor = parseFactor(ref[1]) * parseFactor(ref[4]);
    const upper = ref[2].toUpperCase();
    const name = upper.endsWith(".B") ? keys.get(upper.slice(0, -2)) : named.find(n => n.toUpperCase() === upper);
    if (!name || !Number.isFinite(factor)) return null;
    const part = { ref: name, factor, roundUp: ref[3] === "▲", sign };
    if (ref[5] === undefined) return { kind: "ref", ...part };
    const sides = parseInt(ref[5], 10);
    return sides > 0 ? { kind: "refDice", sides, ...part } : null;
}

/**
 * The terms of `text`, whose references name one of the characteristics
 * `keys` (case-insensitive) or one of `named`. Terms are separated by + and
 * -; the dashes of the rulebooks (–, −) are minuses too. Spaces do not count.
 */
export function parseDamage(text: string, keys: readonly string[], named: readonly string[] = WEAPON_REFS): ParsedDamage {
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
        const term = parseTerm(raw.replace(ROUNDING, "$1").replace(/\s+/g, ""), sign, byUpper, named);
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
function refValue(term: RefPart, valueOf: (ref: string) => number): number {
    // Rounded first so that e.g. ⅓ × 9 is 3, not 2.9999….
    const v = Math.round(term.factor * valueOf(term.ref) * 1e6) / 1e6;
    return term.sign * (term.roundUp ? Math.ceil(v) : Math.floor(v));
}

/**
 * What `terms` add when the reference `ref` counts `by` higher, each term
 * rounded as it is: with S.b 4 raised by 2, "S.b×10" adds 20 and "½S.b" 1.
 * Dice as many as the reference are left out.
 */
export function raisedBy(terms: readonly DamageTerm[], ref: string, by: number, valueOf: (ref: string) => number): number {
    const raised = (r: string) => valueOf(r) + (r === ref ? by : 0);
    return terms.reduce((sum, t) => (t.kind === "ref" && t.ref === ref ? sum + refValue(t, raised) - refValue(t, valueOf) : sum), 0);
}

/** Adds `terms` to `sum`: dice of the same sides add up, "1d10" and "1d10" are "2d10". */
export function addTerms(sum: DamageSum, terms: readonly DamageTerm[], valueOf: (ref: string) => number): DamageSum {
    for (const term of terms) {
        if (term.kind === "dice" || term.kind === "refDice") {
            const count = term.kind === "dice" ? term.count : refValue(term, valueOf);
            sum.dice.set(term.sides, (sum.dice.get(term.sides) ?? 0) + count);
        } else sum.flat += term.kind === "flat" ? term.value : refValue(term, valueOf);
    }
    return sum;
}

/** "2d10+9", "1d10-1", "3"; "0" for nothing. */
export function formatSum({ dice, flat }: DamageSum): string {
    const parts = [...dice].filter(([, count]) => count !== 0).map(([sides, count]) => `${count}d${sides}`);
    if (flat !== 0 || parts.length === 0) parts.push(String(flat));
    return parts.map((p, i) => (i > 0 && !p.startsWith("-") ? `+${p}` : p)).join("");
}

/**
 * The roll of `expression`, as formatSum writes it, for a weapon with
 * Tearing: a die more of its first dice and the lowest dropped, "2d10+4" as
 * "3d10k2+4". The chat's /r reads "k" as keep the highest.
 */
export const withTearing = (expression: string) =>
    expression.replace(/(^|\+)(\d+)d(\d+)/, (_, sign: string, count: string, sides: string) => `${sign}${+count + 1}d${sides}k${count}`);

/** A sum as what it adds to a damage: "+4", "-1", "+1d10+2". */
export function addedBy(sum: DamageSum): string {
    const text = formatSum(sum);
    return text.startsWith("-") ? text : `+${text}`;
}

export interface WeaponMod {
    expr: string;
    enabled: boolean;
    /** What the breakdown names it by instead of its expression, as a grip's "1h". */
    label?: string;
}

/** An enabled modifier whose expression reads: its expression, its terms and what they add. */
export interface CountedMod {
    expr: string;
    label?: string;
    terms: DamageTerm[];
    added: DamageSum;
}

export interface ResolvedDamage {
    /** The base as typed. */
    typed: string;
    /** The base with the modifiers; null when the base is no expression and takes none. */
    sum: DamageSum | null;
    /** The alternative in brackets: with the modifiers, or as typed when it is no expression. */
    alt?: DamageSum | string;
    /** The modifiers counted in `sum`. */
    mods: CountedMod[];
}

/**
 * The damage or penetration `base` with the enabled `mods` whose expressions
 * parse, as parseDamage reads them. A base that does not parse ("Нет",
 * "1d5–1R") stays as typed and takes no modifiers. "A [B]" gives A the
 * modifiers and B too.
 */
export function resolveDamage(
    base: string,
    mods: readonly WeaponMod[],
    keys: readonly string[],
    valueOf: (ref: string) => number,
    named: readonly string[] = WEAPON_REFS,
): ResolvedDamage {
    const typed = base.trim();
    const asTyped = { typed, sum: null, mods: [] };
    const m = typed.match(/^([^[\]]*)(?:\[([^[\]]*)\])?$/);
    if (!m) return asTyped;
    const main = parseDamage(m[1], keys, named);
    if (main.invalid.length || main.terms.length === 0) return asTyped;

    const counted: CountedMod[] = mods
        .filter(mod => mod.enabled)
        .map(mod => ({ expr: mod.expr.trim(), label: mod.label, parsed: parseDamage(mod.expr, keys, named) }))
        .filter(({ parsed }) => parsed.invalid.length === 0 && parsed.terms.length > 0)
        .map(({ expr, label, parsed: { terms } }) => ({ expr, label, terms, added: addTerms(emptySum(), terms, valueOf) }));
    const withMods = (terms: readonly DamageTerm[]) => {
        const sum = addTerms(emptySum(), terms, valueOf);
        for (const mod of counted) addTerms(sum, mod.terms, valueOf);
        return sum;
    };

    const resolved: ResolvedDamage = { typed, sum: withMods(main.terms), mods: counted };
    if (m[2] !== undefined) {
        const alt = parseDamage(m[2], keys, named);
        resolved.alt = alt.invalid.length || alt.terms.length === 0 ? m[2].trim() : withMods(alt.terms);
    }
    return resolved;
}
