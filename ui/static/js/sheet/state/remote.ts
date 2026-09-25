// Remote sheet changes for the blocks that Preact renders: they only change
// the state, the components render it. Only network.js calls this, it stays
// the one writer of the state while old blocks live.
import { batch } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import { isMigratedPath } from "./migrated";
import { runOrQueue } from "./dragFreeze";
import { applyBatchToState, replaceItemInState } from "./applyBatch";
import { expandItem } from "./ui";
import {
    createItemInState, deleteItemFromState, moveItemInState, setLayouts, updateSignalAtPath,
} from "./sync.js";

type Positions = { [id: string]: Position };

export type RemoteSheetMessage =
    | { type: "change"; path: string; change: unknown }
    | { type: "batch" | "autocompleteApplied"; path: string; changes: { [key: string]: unknown } }
    | { type: "createItem"; path: string; itemId: string; itemPos?: Position; init?: unknown }
    | { type: "deleteItem"; path: string }
    | { type: "positionsChanged"; path: string; positions: Positions }
    | { type: "moveItemBetweenGrids"; fromPath: string; toPath: string; itemId: string; toPosition: Position };

function applyToState(msg: RemoteSheetMessage): void {
    switch (msg.type) {
        case "change":
            updateSignalAtPath(msg.path, msg.change);
            break;
        case "batch":
            batch(() => {
                applyBatchToState(msg.path, msg.changes);
                expandItem(msg.path);
            });
            break;
        // The server replaced the item with the collection entry laid over
        // the new item that the picker sent.
        case "autocompleteApplied":
            batch(() => {
                replaceItemInState(msg.path, msg.changes);
                expandItem(msg.path);
            });
            break;
        case "createItem":
            createItemInState(msg.path, msg.itemId, msg.init ?? {}, msg.itemPos);
            break;
        case "deleteItem":
            deleteItemFromState(msg.path);
            break;
        case "positionsChanged":
            setLayouts(msg.path, msg.positions);
            break;
        case "moveItemBetweenGrids":
            moveItemInState(msg.fromPath, msg.toPath, msg.itemId, msg.toPosition);
            break;
    }
}

/**
 * Applies a remote change to the state when its path belongs to a Preact
 * block. Returns false for an old block: its DOM handlers take the message.
 * While an item of a grid is dragged, changes touching that grid wait.
 */
export function applyRemoteToState(msg: RemoteSheetMessage): boolean {
    const paths = msg.type === "moveItemBetweenGrids" ? [msg.fromPath, msg.toPath] : [msg.path];
    if (!paths.some(isMigratedPath)) return false;
    runOrQueue(paths, () => applyToState(msg));
    return true;
}
