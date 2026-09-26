// What every block component can reach: the sheet, whether the viewer can
// edit, the actions that change the state, and the path of the enclosing Scope.
import { createContext } from "preact";
import { useContext } from "preact/hooks";
// Its import hooks into Preact: a component re-renders when a signal it read changes.
import "@preact/signals";
import type { SheetActions } from "../state/actions";
import type { RollDefaults } from "../current";
import type { Autocomplete } from "../autocomplete";

/** One result of the autocomplete collection, as the server sends it. */
export interface AutocompleteResult {
    name: string;
    name_ru?: string;
    [key: string]: unknown;
}

export interface SheetEnv {
    /** The id of the sheet, as the messages about it carry it. */
    sheetId: string;
    canEdit: boolean;
    /** The rolls a new attack or power starts with. */
    rollDefaults: RollDefaults;
    actions: SheetActions;
    autocomplete: Autocomplete | null;
}

export const SheetContext = createContext<SheetEnv | null>(null);

export function useSheet(): SheetEnv {
    const env = useContext(SheetContext);
    if (!env) throw new Error("Sheet components must be rendered inside <Sheet>");
    return env;
}

/**
 * The state path of the nearest Scope. Compound data-ids ("list.items") add
 * all of their segments.
 */
export const PathContext = createContext("");

export const usePath = () => useContext(PathContext);

export const joinPath = (base: string, id: string) => (base ? `${base}.${id}` : id);
