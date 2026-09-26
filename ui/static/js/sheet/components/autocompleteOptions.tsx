// Options of the autocomplete dropdown.
import type { AutocompleteResult } from "./context";

export const displayName = (r: AutocompleteResult) => (r.name_ru ? `${r.name} / ${r.name_ru}` : r.name);

/** The name, and the entry type when the collection has one. */
export function nameAndTypeOption(r: AutocompleteResult) {
    const type = typeof r.entryType === "string" ? r.entryType : "";
    return (
        <div class="ac-header">
            <span class="ac-name">{displayName(r)}</span>
            <span class="ac-type">{type}</span>
        </div>
    );
}

export function nameOption(r: AutocompleteResult) {
    return (
        <div class="ac-header">
            <span class="ac-name">{displayName(r)}</span>
        </div>
    );
}
