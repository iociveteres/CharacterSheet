// Options of the autocomplete dropdown. autocomplete.js puts them in with
// innerHTML; the values come from the server's collections, not from players.
import type { AutocompleteResult } from "./context";

const displayName = (r: AutocompleteResult) => (r.name_ru ? `${r.name} / ${r.name_ru}` : r.name);

/** The name, and the entry type when the collection has one. */
export function nameAndTypeOption(r: AutocompleteResult): string {
    const type = typeof r.entryType === "string" ? r.entryType : "";
    return `<div class="ac-header"><span class="ac-name">${displayName(r)}</span><span class="ac-type">${type}</span></div>`;
}

export function nameOption(r: AutocompleteResult): string {
    return `<div class="ac-header"><span class="ac-name">${displayName(r)}</span></div>`;
}
