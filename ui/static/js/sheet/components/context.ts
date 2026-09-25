// What every block component can reach: whether the viewer can edit, the
// actions that change the state, and the path of the enclosing data-id.
import { createContext } from "preact";
import { useContext } from "preact/hooks";
// Its import hooks into Preact: a component re-renders when a signal it read changes.
import "@preact/signals";
import type { SheetActions } from "../state/actions";

/** One result of the autocomplete collection, as the server sends it. */
export interface AutocompleteResult {
    name: string;
    name_ru?: string;
    [key: string]: unknown;
}

/** What autocomplete.js needs from the owner of an input. */
export interface AutocompleteOwner {
    buildQuery(query: string): object;
    onSelect(result: AutocompleteResult): void;
    /** HTML of one option of the dropdown. */
    renderOption(result: AutocompleteResult): string;
}

/** The Autocomplete instance of the sheet (autocomplete.js). */
export interface AutocompleteService {
    register(input: HTMLInputElement, owner: AutocompleteOwner, options?: { anchor?: Element | null }): void;
    unregister(input: HTMLInputElement): void;
}

export interface SheetEnv {
    canEdit: boolean;
    actions: SheetActions;
    autocomplete: AutocompleteService | null;
}

export const SheetContext = createContext<SheetEnv | null>(null);

export function useSheet(): SheetEnv {
    const env = useContext(SheetContext);
    if (!env) throw new Error("Sheet components must be mounted with mountBlock");
    return env;
}

/**
 * The state path of the nearest element with a data-id, the same path
 * getDataPath reads from the DOM. Compound data-ids ("list.items") add all of
 * their segments.
 */
export const PathContext = createContext("");

export const usePath = () => useContext(PathContext);

export const joinPath = (base: string, id: string) => (base ? `${base}.${id}` : id);
