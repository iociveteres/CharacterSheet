// A sheet on the page with everything of its own: state, computeds, UI state,
// what it tears down, and the edits and rolls it sends signed with its id. Several can
// live on one page at once (_prd/gm_mode/sheet-instance-prd.md): the room
// shows one, GM mode keeps the sheets of an encounter without rendering them.
// Those who show or keep a sheet hold it (holdSheet): a sheet both hold is one
// instance, which goes once the last of them releases it.
import { signal } from "@preact/signals-core";
import type { SheetKindDef } from "./kinds/kind";
import { kindOf } from "./kinds/index";
import type { SheetSignals } from "./schema/sheet";
import { createSheetActions, type SheetActions } from "./state/actions";
import { createState } from "./state/state";
import { SheetUiState } from "./state/ui";
import { DragFreeze } from "./state/dragFreeze";
import { SheetScope } from "./lifecycle";
import { sheetTransport } from "./network";
import { createSheetRolls, type SheetRolls } from "./rollEvents";
import type { RollDefaults, SheetPayload } from "./payload";

export interface SheetInstance {
    sheetId: string;
    kind: SheetKindDef;
    /** The kind as the server names it, e.g. "black_crusade". */
    kindName: string;
    state: SheetSignals;
    ui: SheetUiState;
    scope: SheetScope;
    freeze: DragFreeze;
    actions: SheetActions;
    rolls: SheetRolls;
    canEdit: boolean;
    rollDefaults: RollDefaults;
    /** Releases what the sheet set up and takes it out of the registry. */
    dispose(): void;
}

/**
 * The sheets on the page by id; network.ts applies the remote changes of a
 * sheet to its instance. A sheet has one instance: a second view of it shows
 * the same one, or the edits of one would not reach the other (the server
 * does not send an edit back to the tab that made it).
 */
export const sheets = new Map<string, SheetInstance>();

interface InstanceOptions {
    /** The UI state of the sheet read again, so its collapsed items and open tabs stay. */
    ui?: SheetUiState;
}

/** A sheet built from `payload` without rendering it, in the registry until dispose(). */
export function createSheetInstance(payload: SheetPayload, { ui = new SheetUiState() }: InstanceOptions = {}): SheetInstance {
    const { sheetId } = payload;
    if (sheets.has(sheetId)) throw new Error(`Sheet ${sheetId} is already on the page`);
    const kind = kindOf(payload.kind);
    if (!kind) throw new Error(`Unknown sheet kind "${payload.kind}"`);

    const state = createState(kind, payload.content);
    const scope = new SheetScope();
    const instance: SheetInstance = {
        sheetId,
        kind,
        kindName: payload.kind,
        state,
        ui,
        scope,
        freeze: new DragFreeze(),
        actions: createSheetActions(state, sheetTransport(sheetId)),
        rolls: createSheetRolls(sheetId, state, scope),
        canEdit: payload.canEdit,
        rollDefaults: payload.rollDefaults,
        dispose() {
            scope.teardown();
            if (sheets.get(sheetId) === instance) sheets.delete(sheetId);
        },
    };
    sheets.set(sheetId, instance);
    return instance;
}

/** How many hold each sheet on the page: the room's view, the encounter. */
const holders = new Map<string, number>();

/**
 * Changes whenever a sheet comes onto the page, is read again or leaves it:
 * what looks sheets up by id in `sheets` reads it to follow them.
 */
export const sheetsChanged = signal(0);

/**
 * The instance of the sheet of `payload`: the one on the page, which is
 * current, as the remote changes reach it, or a new one. The caller holds it
 * until releaseSheet().
 */
export function holdSheet(payload: SheetPayload): SheetInstance {
    const { sheetId } = payload;
    const held = sheets.get(sheetId);
    holders.set(sheetId, (holders.get(sheetId) ?? 0) + 1);
    if (held) return held;
    const sheet = createSheetInstance(payload);
    sheetsChanged.value++;
    return sheet;
}

/** Lets go of the sheet; the last to let go disposes it. */
export function releaseSheet(sheetId: string): void {
    const count = (holders.get(sheetId) ?? 0) - 1;
    if (count > 0) {
        holders.set(sheetId, count);
        return;
    }
    holders.delete(sheetId);
    const sheet = sheets.get(sheetId);
    if (!sheet) return;
    sheet.dispose();
    sheetsChanged.value++;
}

/**
 * Builds the sheet on the page anew from `payload`, read again from the
 * server; it keeps its collapsed items and open tabs, and its holders. Views
 * of the old instance move to the new one on sheet:replaced, before the old
 * one is disposed.
 */
export function replaceSheet(payload: SheetPayload): SheetInstance | null {
    const old = sheets.get(payload.sheetId);
    if (!old) return null;
    sheets.delete(payload.sheetId);
    const sheet = createSheetInstance(payload, { ui: old.ui });
    sheetsChanged.value++;
    document.dispatchEvent(new CustomEvent("sheet:replaced", { detail: { sheetID: payload.sheetId } }));
    old.dispose();
    return sheet;
}
