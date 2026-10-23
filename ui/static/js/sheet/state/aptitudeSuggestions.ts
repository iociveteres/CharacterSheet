// Suggestions for a list of aptitudes, as the character's and an
// advancement's are typed ("WS, Off"): they complete the token at the caret
// (tokenAt, insertToken) with the aptitudes the list does not name yet.
import { CHARACTERISTIC_APTITUDES, GENERAL_APTITUDE, type Characteristic, type StatSet } from "../schema/constants";
import type { SuggestionGroup } from "../components/SuggestField";

/** Whether `word`, in upper case, begins the key or a word of the label. */
const matches = ({ key, label }: Characteristic, word: string) =>
    !word || key.toUpperCase().startsWith(word) || label.toUpperCase().split(/\s+/).some(w => w.startsWith(word));

/**
 * What the token `query` of `text` can become, null before the player typed
 * listing them all. `general` offers General too: an advancement names it,
 * the character has it without naming.
 */
export function aptitudeSuggestions(stats: StatSet, text: string, query: string | null, general: boolean): SuggestionGroup[] {
    const q = (query ?? "").toUpperCase();
    const tokens = text.split(/[\s,]+/).filter(Boolean).map(t => t.toUpperCase());
    // The token being typed is not a name the others should give way to.
    const own = tokens.indexOf(q);
    if (query !== null && own >= 0) tokens.splice(own, 1);
    const named = new Set(tokens);

    const group = (label: string, aptitudes: readonly Characteristic[]) => ({
        label,
        options: aptitudes
            .filter(a => !named.has(a.key.toUpperCase()) && matches(a, q))
            .map(a => ({ value: a.key, label: `${a.key} — ${a.label}` })),
    });
    return [
        group("Characteristics", CHARACTERISTIC_APTITUDES),
        group("Specialisations", general ? [...stats.aptitudes, GENERAL_APTITUDE] : stats.aptitudes),
    ].filter(g => g.options.length > 0);
}
