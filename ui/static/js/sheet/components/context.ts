// What every block component can reach: the sheet, its state, whether the
// viewer can edit, the actions that change the state, and the path of the
// enclosing Scope.
import { createContext } from "preact";
import { useContext } from "preact/hooks";
// Its import hooks into Preact: a component re-renders when a signal it read changes.
import "@preact/signals";
import { VIEW_ONLY_ACTIONS, type SheetActions } from "../state/actions";
import type { RollDefaults } from "../payload";
import type { Autocomplete } from "../autocomplete";
import type { StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import type { SheetUiState } from "../state/ui";
import type { DragFreeze } from "../state/dragFreeze";
import type { SheetRolls } from "../rollEvents";
import { online } from "../connection";

/** One result of the autocomplete collection, as the server sends it. */
export interface AutocompleteResult {
    name: string;
    name_ru?: string;
    [key: string]: unknown;
}

export interface SheetEnv {
    /** The id of the sheet, as the messages about it carry it. */
    sheetId: string;
    /** The sheet's signals with the computeds of its kind; components read them. */
    state: SheetSignals;
    /** Collapsed items and open tabs of the sheet. */
    ui: SheetUiState;
    /** The grids of the sheet frozen during a drag. */
    freeze: DragFreeze;
    canEdit: boolean;
    /** The rolls a new attack or power starts with. */
    rollDefaults: RollDefaults;
    /** The characteristics and skills of the sheet's kind. */
    stats: StatSet;
    actions: SheetActions;
    /** The rolls of the sheet, signed with its character. */
    rolls: SheetRolls;
    autocomplete: Autocomplete | null;
    /**
     * A creature looked at before it joins a fight: read only and without
     * rolls, which would go to the room's chat under the creature's name.
     */
    preview?: boolean;
}

export const SheetContext = createContext<SheetEnv | null>(null);

export function useSheet(): SheetEnv {
    const env = useContext(SheetContext);
    if (!env) throw new Error("Sheet components must be rendered inside <Sheet>");
    // Read in render, so the component re-renders when the connection drops or returns.
    if (env.canEdit && online.value) return env;
    // Without edit rights no call site has to guard its writes: the server would refuse them.
    return { ...env, canEdit: false, actions: VIEW_ONLY_ACTIONS };
}

/**
 * The state path of the nearest Scope. Compound data-ids ("list.items") add
 * all of their segments.
 */
export const PathContext = createContext("");

export const usePath = () => useContext(PathContext);

export const joinPath = (base: string, id: string) => (base ? `${base}.${id}` : id);
