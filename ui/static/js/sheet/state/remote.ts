// Remote sheet changes for the blocks that Preact renders: they only change
// the state, the components render it. Only network.js calls this, it stays
// the one writer of the state while old blocks live.
import { batch } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import { isMigratedPath } from "./migrated";
import { runOrQueue } from "./dragFreeze";
import { applyBatchToState, resetItemToFactory } from "./applyBatch";
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

/**
 * Applies a remote change to the state when its path belongs to a Preact
 * block. Returns false for an old block: its DOM handlers take the message.
 * While an item of a grid is dragged, changes touching that grid wait.
 */
export function applyRemoteToState(msg: RemoteSheetMessage): boolean {
    switch (msg.type) {
        case "change":
            if (!isMigratedPath(msg.path)) return false;
            runOrQueue([msg.path], () => updateSignalAtPath(msg.path, msg.change));
            return true;

        case "batch":
            if (!isMigratedPath(msg.path)) return false;
            runOrQueue([msg.path], () => batch(() => {
                applyBatchToState(msg.path, msg.changes);
                expandItem(msg.path);
            }));
            return true;

        case "autocompleteApplied":
            if (!isMigratedPath(msg.path)) return false;
            runOrQueue([msg.path], () => batch(() => {
                resetItemToFactory(msg.path);
                applyBatchToState(msg.path, msg.changes);
                expandItem(msg.path);
            }));
            return true;

        case "createItem":
            if (!isMigratedPath(msg.path)) return false;
            runOrQueue([msg.path], () => createItemInState(msg.path, msg.itemId, msg.init ?? {}, msg.itemPos));
            return true;

        case "deleteItem":
            if (!isMigratedPath(msg.path)) return false;
            runOrQueue([msg.path], () => deleteItemFromState(msg.path));
            return true;

        case "positionsChanged":
            if (!isMigratedPath(msg.path)) return false;
            runOrQueue([msg.path], () => setLayouts(msg.path, msg.positions));
            return true;

        case "moveItemBetweenGrids":
            if (!isMigratedPath(msg.fromPath) && !isMigratedPath(msg.toPath)) return false;
            runOrQueue([msg.fromPath, msg.toPath],
                () => moveItemInState(msg.fromPath, msg.toPath, msg.itemId, msg.toPosition));
            return true;
    }
}
