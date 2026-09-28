// Suggestions for the name of an entry of characteristics, whose syntax
// system.ts parseCharacteristics reads: they complete the token at the caret.
import type { Characteristic } from "../schema/constants";
import type { SuggestionGroup } from "../components/SuggestField";
import { inAny } from "./computed";

const SEPARATOR = /[\s,]/;

function tokenSpan(text: string, caret: number): [number, number] {
    let start = caret;
    while (start > 0 && !SEPARATOR.test(text[start - 1])) start--;
    let end = caret;
    while (end < text.length && !SEPARATOR.test(text[end])) end++;
    return [start, end];
}

/** The token at `caret`, "" between separators. */
export function tokenAt(text: string, caret: number): string {
    const [start, end] = tokenSpan(text, caret);
    return text.slice(start, end);
}

/**
 * `text` with `value` for the token at `caret`. Before the player typed, the
 * caret sits after what is already there, so `value` is added as a new token.
 */
export function insertToken(text: string, caret: number, value: string, typed: boolean): string {
    if (!typed) {
        const rest = text.replace(/[\s,]+$/, "");
        return rest ? `${rest}, ${value}` : value;
    }
    const [start, end] = tokenSpan(text, caret);
    return text.slice(0, start) + value + text.slice(end);
}

/** What Any picks of the sheet's `characteristics`, e.g. "all but Inf and Cor". */
export function anyScope(characteristics: readonly Characteristic[]): string {
    const outside = characteristics.filter(c => !inAny(c.key)).map(c => c.key);
    return outside.length ? `all but ${outside.join(" and ")}` : "all characteristics";
}

/** Whether `word`, typed in upper case, begins the key or a word of the label. */
const matches = ({ key, label }: Characteristic, word: string) =>
    !word || key.toUpperCase().startsWith(word) || label.toUpperCase().split(/\s+/).some(w => w.startsWith(word));

/**
 * What the token `query` of `text` can become: Any, the characteristics not
 * named yet and, after Any or a "-", the ones to leave out. Null before the
 * player typed lists them all.
 */
export function characteristicSuggestions(
    characteristics: readonly Characteristic[],
    text: string,
    query: string | null,
): SuggestionGroup[] {
    const q = (query ?? "").toUpperCase();
    const tokens = text.split(/[\s,]+/).filter(Boolean).map(t => t.toUpperCase());
    // The token being typed is not a name the others should give way to.
    const own = tokens.indexOf(q);
    if (query !== null && own >= 0) tokens.splice(own, 1);

    const named = new Set(tokens.filter(t => !t.startsWith("-")));
    const leftOut = new Set(tokens.filter(t => t.startsWith("-")).map(t => t.slice(1)));
    const hasAny = named.has("ANY");
    const excluding = q.startsWith("-");
    const word = excluding ? q.slice(1) : q;

    const leaveOut = {
        label: "Leave out",
        options: characteristics
            .filter(c => inAny(c.key) && !leftOut.has(c.key.toUpperCase()) && matches(c, word))
            .map(c => ({ value: `-${c.key}`, label: `-${c.key} — ${c.label}` })),
    };
    if (excluding) return leaveOut.options.length ? [leaveOut] : [];

    const all = {
        label: "All",
        options: !hasAny && "ANY".startsWith(q) ? [{ value: "Any", label: `Any — ${anyScope(characteristics)}` }] : [],
    };
    const add = {
        label: "Characteristics",
        options: characteristics
            // After Any only the ones it leaves out are worth adding.
            .filter(c => !named.has(c.key.toUpperCase()) && (!hasAny || !inAny(c.key)) && matches(c, word))
            .map(c => ({ value: c.key, label: `${c.key} — ${c.label}` })),
    };
    const groups = hasAny ? [leaveOut, add] : [all, add];
    return groups.filter(g => g.options.length > 0);
}
