// Remote sheet changes: they only change the state, the components render it.
// network.ts calls this for every sheet message of the open sheet.
import { batch } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import { runOrQueue } from "./dragFreeze";
import { applyBatchToState, replaceItemInState } from "./applyBatch";
import { expandItem } from "./ui";
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
 * Applies a remote change to the state. While an item of a grid is dragged,
 * changes touching that grid wait.
 */
export function applyRemoteToState(msg: RemoteSheetMessage): void {
    const paths = msg.type === "moveItemBetweenGrids" ? [msg.fromPath, msg.toPath] : [msg.path];
    runOrQueue(paths, () => applyToState(msg));
}
