// A sheet on the page with everything of its own: state, computeds, UI state,
// what it tears down, its rolls and the edits it sends. Several can live on
// one page at once (_prd/gm_mode/sheet-instance-prd.md); until step 5 of that
// plan the page still has one sheet, and createSheetInstance is not there yet.
import type { SheetKindDef } from "./kinds/kind";
import type { SheetSignals } from "./schema/sheet";
import type { SheetActions } from "./state/actions";
import type { SheetUiState } from "./state/ui";
import type { DragFreeze } from "./state/dragFreeze";
import type { SheetScope } from "./lifecycle";
import type { RollDefaults, SheetPayload } from "./current";

export interface SheetInstance {
    sheetId: string;
    kind: SheetKindDef;
    state: SheetSignals;
    ui: SheetUiState;
    scope: SheetScope;
    freeze: DragFreeze;
    actions: SheetActions;
    canEdit: boolean;
    rollDefaults: RollDefaults;
    /** Releases what the sheet set up and takes it out of the registry. */
    dispose(): void;
}

/** A sheet built from `payload` without rendering it. */
export function createSheetInstance(payload: SheetPayload): SheetInstance {
    throw new Error(`createSheetInstance(${payload.sheetId}): comes with step 5 of sheet-instance-prd.md`);
}
