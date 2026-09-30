// A sheet on the page with everything of its own: state, computeds, UI state,
// what it tears down, and the edits and rolls it sends signed with its id. Several can
// live on one page at once (_prd/gm_mode/sheet-instance-prd.md): the room
// shows one, GM mode will keep the sheets of an encounter without rendering them.
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
