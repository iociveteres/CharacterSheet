// Suggestions for the expression of a damage modifier, whose syntax damage.ts
// parseDamage reads: they complete the term at the caret, keeping a factor
// typed before it ("½W" offers "½WS.b").
import type { Characteristic } from "../schema/constants";
import type { SuggestionGroup } from "../components/SuggestField";
import type { TextPart } from "../components/TextMarks";
import { BASE_PR, addTerms, emptySum, formatSum, parseDamage } from "../damage";

const SIGN = /[+\-–—−]/;

/** The term around `caret`, without the spaces next to its signs. */
function termSpan(text: string, caret: number): [number, number] {
    let start = caret;
    while (start > 0 && !SIGN.test(text[start - 1])) start--;
    let end = caret;
    while (end < text.length && !SIGN.test(text[end])) end++;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return [start, end];
}

/** The term at `caret`, "" between signs. */
export function termAt(text: string, caret: number): string {
    const [start, end] = termSpan(text, caret);
    return text.slice(start, end);
}

/**
 * `text` with `value` for the term at `caret`. Before the player typed, the
 * caret sits after what is already there, so `value` is added to it.
 */
export function insertTerm(text: string, caret: number, value: string, typed: boolean): string {
    if (!typed) {
        const rest = text.replace(/[\s+]+$/, "");
        return rest ? `${rest}+${value}` : value;
    }
    const [start, end] = termSpan(text, caret);
    return text.slice(0, start) + value + text.slice(end);
}

/** The terms and signs of `text`, the terms of `invalid` marked. */
export function termParts(text: string, invalid: readonly string[]): TextPart[] {
    return text.split(/([+\-–—−])/).flatMap((part, i) => {
        const term = part.trim();
        if (i % 2 === 1 || !term || !invalid.includes(term)) return [{ text: part, marked: false }];
        const lead = part.slice(0, part.indexOf(term));
        return [{ text: lead, marked: false }, { text: term, marked: true }, { text: part.slice(lead.length + term.length), marked: false }];
    });
}

const FACTOR = /^(½|\d+\/\d+|\d*\.\d+|\d+)\s*[×x*]?\s*/i;

/** Whether `word`, typed in upper case, begins the key or a word of the label. */
const matches = (key: string, label: string, word: string) =>
    !word || key.toUpperCase().startsWith(word) || label.toUpperCase().split(/\s+/).some(w => w.startsWith(word));

const rank = (key: string, word: string) => (key.toUpperCase() === word ? 0 : key.toUpperCase().startsWith(word) ? 1 : 2);

// The parts and multiples of a reference the rulebooks use.
const FACTORS = [
    { prefix: "½", suffix: "", text: "half, rounded down" },
    { prefix: "½", suffix: "▲", text: "half, rounded up" },
    { prefix: "2×", suffix: "", text: "twice" },
    { prefix: "3×", suffix: "", text: "three times" },
] as const;

/**
 * What the term `query` can become: the bonus of a characteristic or the base
 * psy rating, times the factor typed before it, and dice; a reference typed
 * whole can take a factor, a part of one can round up. Null before the
 * player typed lists them all. Each shows what it adds now, by `valueOf`.
 */
export function damageSuggestions(
    characteristics: readonly Characteristic[],
    query: string | null,
    valueOf: (ref: string) => number,
): SuggestionGroup[] {
    const keys = characteristics.map(c => c.key);
    const adds = (value: string) => {
        const { terms, invalid } = parseDamage(value, keys);
        return invalid.length ? "" : ` = ${formatSum(addTerms(emptySum(), terms, valueOf))}`;
    };

    const q = (query ?? "").trim();
    const factor = q.match(FACTOR);
    // A whole number reads as the number of dice too; a part needs no ×.
    const whole = factor && /^\d+$/.test(factor[1]) ? factor[1] : null;
    const prefix = !factor || whole === "1" ? "" : whole ? `${whole}×` : factor[1];
    const rest = factor ? q.slice(factor[0].length) : q;
    const word = rest.replace(/\.b?$/i, "").toUpperCase();

    const own = parseDamage(q, keys);
    const term = own.terms.length === 1 && own.invalid.length === 0 ? own.terms[0] : null;
    const round = {
        label: "Rounding",
        options: term?.kind === "ref" && !Number.isInteger(term.factor) && !/[▲▼]$/.test(q)
            ? [{ value: `${q}▲`, label: `${q}▲ — round up${adds(`${q}▲`)}` }, { value: `${q}▼`, label: `${q}▼ — round down${adds(q)}` }]
            : [],
    };
    // "bs" or "BS.b" without a factor: the reference the others would be of.
    const named = factor ? null
        : BASE_PR.toUpperCase() === word ? BASE_PR
            : characteristics.find(c => c.key.toUpperCase() === word && word !== "")?.key;
    const ref = named === BASE_PR ? BASE_PR : named ? `${named}.b` : null;
    const factors = {
        label: "With a factor",
        options: ref
            ? FACTORS.map(({ prefix: p, suffix, text }) => {
                const value = `${p}${ref}${suffix}`;
                return { value, label: `${value} — ${text}${adds(value)}` };
            })
            : [],
    };
    const bonus = {
        label: "Characteristic bonus",
        // "S" names Strength before the "Skill" of WS and BS.
        options: characteristics
            .filter(c => matches(c.key, c.label, word))
            .sort((a, b) => rank(a.key, word) - rank(b.key, word))
            .map(c => {
                const value = `${prefix}${c.key}.b`;
                return { value, label: `${value} — ${c.label} bonus${adds(value)}` };
            }),
    };
    const pr = {
        label: "Psy rating",
        options: matches(BASE_PR, "base psy rating", word)
            ? [{ value: `${prefix}${BASE_PR}`, label: `${prefix}${BASE_PR} — base psy rating${adds(`${prefix}${BASE_PR}`)}` }]
            : [],
    };
    const count = whole ?? "1";
    const dice = {
        label: "Dice",
        options: factor && !whole ? [] : ["d10", "d5"]
            .filter(d => !rest || d.startsWith(rest.toLowerCase()))
            .map(d => `${count}${d}`),
    };
    return [round, bonus, pr, factors, dice].filter(g => g.options.length > 0);
}
