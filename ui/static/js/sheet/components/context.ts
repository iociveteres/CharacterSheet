// What every block component can reach: the sheet, its state, whether the
// viewer can edit, the actions that change the state, and the path of the
// enclosing Scope.
import { createContext } from "preact";
import { useContext } from "preact/hooks";
// Its import hooks into Preact: a component re-renders when a signal it read changes.
import "@preact/signals";
import type { ReadonlySignal, Signal } from "@preact/signals";
import { VIEW_ONLY_ACTIONS, type SheetActions } from "../core/actions";
import type { RollDefaults } from "../payload";
import type { Autocomplete, AutocompleteResult } from "../autocomplete";
import type { PsykanaTerms, StatSet } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import type { SheetUiState } from "../core/ui";
import type { DragFreeze } from "../core/dragFreeze";
import type { SheetRolls } from "../rollEvents";
import type { CastCost, GearItemParts, Preparation } from "./kindParts";
import { online } from "../connection";

export type { AutocompleteResult };

export interface SheetEnv {
    /** The id of the sheet, as the messages about it carry it. */
    sheetId: string;
    /** The kind as the server names it; the autocomplete searches its catalog. */
    kindName: string;
    /** The sheet's signals with the computeds of its kind; components read them. */
    state: SheetSignals;
    /** Collapsed items and open tabs of the sheet. */
    ui: SheetUiState;
    /** The grids of the sheet frozen during a drag. */
    freeze: DragFreeze;
    /**
     * Whether the user may edit the sheet. It changes while the sheet is open,
     * so components read canEdit of useSheet(), which follows it.
     */
    editable: ReadonlySignal<boolean>;
    /** The rolls a new attack or power starts with. */
    rollDefaults: RollDefaults;
    /** The hash of the portrait, null without one. Components read it; portraitChanged sets it (core/remote.ts). */
    portrait: Signal<string | null>;
    /** The characteristics and skills of the sheet's kind. */
    stats: StatSet;
    /** What the sheet's kind calls its psykana and powers. */
    terms: PsykanaTerms;
    /** What a cast costs, in a kind that charges for it; null in one that does not. */
    castCost: CastCost | null;
    /** The spells of the day, in a kind whose casters prepare them; null in one whose casters do not. */
    preparation: Preparation | null;
    /** What a gear item has of the kind's own; null in a kind whose items have only the shared fields. */
    gearItemParts: GearItemParts | null;
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

/** The sheet as a component sees it in this render: whether it can edit now, and actions that send nothing when it cannot. */
export type LiveSheetEnv = SheetEnv & { canEdit: boolean };

export const SheetContext = createContext<SheetEnv | null>(null);

// One of each per sheet, so a component gets the same object in every render.
const editing = new WeakMap<SheetEnv, LiveSheetEnv>();
const viewing = new WeakMap<SheetEnv, LiveSheetEnv>();

export function useSheet(): LiveSheetEnv {
    const env = useContext(SheetContext);
    if (!env) throw new Error("Sheet components must be rendered inside <Sheet>");
    // Read in render, so every component that asked re-renders when the rights
    // change or the connection drops or returns: a memoized grid card too.
    if (env.editable.value && online.value && !env.preview) {
        let live = editing.get(env);
        if (!live) editing.set(env, live = { ...env, canEdit: true });
        return live;
    }
    // Without edit rights no call site has to guard its writes: the server would refuse them.
    let live = viewing.get(env);
    if (!live) viewing.set(env, live = { ...env, canEdit: false, actions: VIEW_ONLY_ACTIONS });
    return live;
}

/**
 * The state path of the nearest Scope. Compound data-ids ("list.items") add
 * all of their segments.
 */
export const PathContext = createContext("");

export const usePath = () => useContext(PathContext);

export const joinPath = (base: string, id: string) => (base ? `${base}.${id}` : id);
