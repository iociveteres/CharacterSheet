// Suggestions for the expression of a damage modifier, whose syntax damageExpression.ts
// parseDamage reads: they complete the term at the caret, keeping a factor
// typed before it ("½W" offers "½WS.b").
import type { Characteristic } from "../schema/constants";
import type { SuggestionGroup } from "../components/SuggestField";
import type { TextPart } from "../components/TextMarks";
import { BASE_PR, POWER_PR, SIZE, WEAPON_REFS, addTerms, emptySum, formatSum, parseDamage } from "./damageExpression";
import { t } from "../../i18n";

/** The references by name: the group they are listed in and what they are. */
const NAMED: { [ref: string]: { group: string; label: string } } = {
    [BASE_PR]: { group: t("sheet.termsPowers.psy.psyRating"), label: t("sheet.rolls.ref.basePR") },
    [POWER_PR]: { group: t("sheet.termsPowers.psy.psyRating"), label: t("sheet.rolls.ref.powerPR") },
    [SIZE]: { group: t("sheet.terms.stat.size"), label: t("sheet.rolls.ref.size") },
};
const namedOf = (ref: string) => NAMED[ref] ?? { group: ref, label: ref };

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

/** A psy rating by what follows its lower-case prefix: "PR" names bPR too. */
const rating = (name: string) => name.replace(/^[a-z]+/, "").toUpperCase();

// The parts and multiples of a reference the rulebooks use.
const FACTORS = [
    { prefix: "½", suffix: "", text: t("sheet.rolls.factor.half") },
    { prefix: "½", suffix: "▲", text: t("sheet.rolls.factor.halfUp") },
    { prefix: "2×", suffix: "", text: t("sheet.rolls.factor.twice") },
    { prefix: "3×", suffix: "", text: t("sheet.rolls.factor.thrice") },
] as const;

/**
 * What the term `query` can become: the bonus of a characteristic or one of
 * the psy ratings `named`, times the factor typed before it, and dice; a
 * reference typed whole can take a factor, a part of one can round up. Null
 * before the player typed lists them all. Each shows what it adds now, by
 * `valueOf`. Without `dice`, for a value that is a number, no dice.
 */
export function damageSuggestions(
    characteristics: readonly Characteristic[],
    query: string | null,
    valueOf: (ref: string) => number,
    named: readonly string[] = WEAPON_REFS,
    dice = true,
): SuggestionGroup[] {
    const keys = characteristics.map(c => c.key);
    const adds = (value: string) => {
        const { terms, invalid } = parseDamage(value, keys, named);
        return invalid.length ? "" : ` = ${formatSum(addTerms(emptySum(), terms, valueOf))}`;
    };

    const q = (query ?? "").trim();
    const factor = q.match(FACTOR);
    // A whole number reads as the number of dice too; a part needs no ×.
    const whole = factor && /^\d+$/.test(factor[1]) ? factor[1] : null;
    const prefix = !factor || whole === "1" ? "" : whole ? `${whole}×` : factor[1];
    const rest = factor ? q.slice(factor[0].length) : q;
    const word = rest.replace(/\.b?$/i, "").toUpperCase();

    const own = parseDamage(q, keys, named);
    const term = own.terms.length === 1 && own.invalid.length === 0 ? own.terms[0] : null;
    const round = {
        label: t("sheet.rolls.suggest.rounding"),
        options: term?.kind === "ref" && !Number.isInteger(term.factor) && !/[▲▼]$/.test(q)
            ? [
                { value: `${q}▲`, label: `${q}▲ — ${t("sheet.rolls.suggest.roundUp")}${adds(`${q}▲`)}` },
                { value: `${q}▼`, label: `${q}▼ — ${t("sheet.rolls.suggest.roundDown")}${adds(q)}` },
            ]
            : [],
    };
    // "bs", "BS.b" or "bpr" without a factor: the reference the others would be of.
    const byName = factor ? undefined : named.find(n => n.toUpperCase() === word) ?? named.find(n => rating(n) === word);
    const key = factor || byName ? undefined : characteristics.find(c => c.key.toUpperCase() === word && word !== "")?.key;
    const ref = byName ?? (key ? `${key}.b` : null);
    const factors = {
        label: t("sheet.rolls.suggest.withFactor"),
        options: ref
            ? FACTORS.map(({ prefix: p, suffix, text }) => {
                const value = `${p}${ref}${suffix}`;
                return { value, label: `${value} — ${text}${adds(value)}` };
            })
            : [],
    };
    const bonus = {
        label: t("sheet.terms.stat.characteristicBonus"),
        // "S" names Strength before the "Skill" of WS and BS.
        options: characteristics
            .filter(c => matches(c.key, c.label, word))
            .sort((a, b) => rank(a.key, word) - rank(b.key, word))
            .map(c => {
                const value = `${prefix}${c.key}.b`;
                return { value, label: `${value} — ${t("sheet.rolls.suggest.charBonus", { characteristic: c.label })}${adds(value)}` };
            }),
    };
    // A group per kind of reference by name: the psy ratings, Size.
    const namedGroups = [...new Set(named.map(n => namedOf(n).group))].map(group => ({
        label: group,
        // The one typed whole first: "PR" in a power is its PR, then bPR.
        options: named.filter(n => namedOf(n).group === group && (matches(n, group, word) || rating(n).startsWith(word)))
            .sort((a, b) => Number(a.toUpperCase() !== word) - Number(b.toUpperCase() !== word))
            .flatMap(n => {
                const value = `${prefix}${n}`;
                const option = { value, label: `${value} — ${namedOf(n).label}${adds(value)}` };
                // Powers roll PR dice: "PRd10", "2×PRd10".
                if (n !== POWER_PR || (factor && !whole)) return [option];
                return [option, { value: `${value}d10`, label: `${value}d10 — ${t("sheet.rolls.suggest.diceAsMany")}${adds(`${value}d10`)}` }];
            }),
    }));
    const count = whole ?? "1";
    const dieOptions = {
        label: t("sheet.rolls.suggest.dice"),
        options: !dice || (factor && !whole) ? [] : ["d10", "d5"]
            .filter(d => !rest || d.startsWith(rest.toLowerCase()))
            .map(d => `${count}${d}`),
    };
    return [round, bonus, ...namedGroups, factors, dieOptions].filter(g => g.options.length > 0);
}
