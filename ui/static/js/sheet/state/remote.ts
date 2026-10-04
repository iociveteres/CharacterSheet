// Remote sheet changes: they only change the state, the components render it.
// network.ts calls this for every sheet message of a sheet on the page.
import { batch } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import type { SheetSignals } from "../schema/sheet";
import type { DragFreeze } from "./dragFreeze";
import { applyBatchToState, replaceItemInState } from "./applyBatch";
import type { SheetUiState } from "./ui";
import {
    createItemInState, deleteItemFromState, moveItemInState, setLayouts, updateSignalAtPath,
} from "./sync";

type Positions = { [id: string]: Position };

export type RemoteSheetMessage =
    | { type: "change"; path: string; change: unknown }
    | { type: "batch" | "autocompleteApplied"; path: string; changes: { [key: string]: unknown } }
    | { type: "createItem"; path: string; itemId: string; itemPos?: Position; init?: unknown }
    | { type: "deleteItem"; path: string }
    | { type: "positionsChanged"; path: string; positions: Positions }
    | { type: "moveItemBetweenGrids"; fromPath: string; toPath: string; itemId: string; toPosition: Position };

/** What a remote change reaches: the sheet's state, its UI state and its frozen grids. */
export interface RemoteTarget {
    state: SheetSignals;
    ui: SheetUiState;
    freeze: DragFreeze;
}

function applyToState({ state, ui }: RemoteTarget, msg: RemoteSheetMessage): void {
    switch (msg.type) {
        case "change":
            updateSignalAtPath(state, msg.path, msg.change);
            break;
        case "batch":
            batch(() => {
                applyBatchToState(state, msg.path, msg.changes);
                ui.expandItem(msg.path);
            });
            break;
        // The server replaced the item with the collection entry laid over
        // the new item that the picker sent.
        case "autocompleteApplied":
            batch(() => {
                replaceItemInState(state, msg.path, msg.changes);
                ui.expandItem(msg.path);
            });
            break;
        case "createItem":
            createItemInState(state, msg.path, msg.itemId, msg.init ?? {}, msg.itemPos);
            break;
        case "deleteItem":
            deleteItemFromState(state, msg.path);
            break;
        case "positionsChanged":
            setLayouts(state, msg.path, msg.positions);
            break;
        case "moveItemBetweenGrids":
            moveItemInState(state, msg.fromPath, msg.toPath, msg.itemId, msg.toPosition);
            break;
    }
}

/**
 * Applies a remote change to the state. While an item of a grid is dragged,
 * changes touching that grid wait.
 */
export function applyRemoteToState(sheet: RemoteTarget, msg: RemoteSheetMessage): void {
    const paths = msg.type === "moveItemBetweenGrids" ? [msg.fromPath, msg.toPath] : [msg.path];
    sheet.freeze.runOrQueue(paths, () => applyToState(sheet, msg));
}
