// Local edits of the sheet. Each one changes the state and sends its message
// in the format the server has always taken. network.js builds the instance
// with its transport; components reach it through the sheet context.
import type { Position } from "../schema/content.gen";
import { newItemOf } from "../schema/newItem";
import { specAtPath } from "./fromJson";
import {
    createItemInState, deleteItemFromState, moveItemInState, setLayouts, updateSignalAtPath, updateSignalBatch,
} from "./sync.js";

export type Positions = { [id: string]: Position };

export interface SheetActions {
    /** A field edit: the signal at `path` changes and the change is sent. */
    change(path: string, value: unknown): void;
    /** Several fields under `path` at once, e.g. the four advances of a skill row. */
    batch(path: string, changes: { [key: string]: unknown }): void;
    createItem(gridPath: string, itemId: string, init: object, itemPos: Position): void;
    deleteItem(itemPath: string): void;
    positionsChanged(gridPath: string, positions: Positions): void;
    moveItemBetweenGrids(fromPath: string, toPath: string, itemId: string, toPosition: Position): void;
    /** `base` is the item the entry is laid over; a new item of the schema by default. */
    autocompleteApply(itemPath: string, collection: string, name: string, base?: object): void;
}

/** How messages leave. network.js adds eventID and sheetID. */
export interface Transport {
    send(msg: object): void;
    /** Debounced by `key`, like field edits: only the last message in 200 ms goes. */
    schedule(msg: object, key: string): void;
}

export function createSheetActions(transport: Transport): SheetActions {
    return {
        change(path, value) {
            updateSignalAtPath(path, value);
            transport.schedule({ type: "change", path, change: value }, path);
        },

        batch(path, changes) {
            updateSignalBatch(path, changes);
            transport.schedule({ type: "batch", path, changes }, path);
        },

        createItem(gridPath, itemId, init, itemPos) {
            createItemInState(gridPath, itemId, init, itemPos);
            transport.send({ type: "createItem", path: gridPath, itemId, itemPos, init });
        },

        deleteItem(itemPath) {
            deleteItemFromState(itemPath);
            transport.send({ type: "deleteItem", path: itemPath });
        },

        positionsChanged(gridPath, positions) {
            setLayouts(gridPath, positions);
            transport.schedule({ type: "positionsChanged", path: gridPath, positions }, gridPath);
        },

        moveItemBetweenGrids(fromPath, toPath, itemId, toPosition) {
            moveItemInState(fromPath, toPath, itemId, toPosition);
            transport.send({ type: "moveItemBetweenGrids", fromPath, toPath, itemId, toPosition });
        },

        // The server replaces the item with base || the collection entry, so
        // it becomes a new one with the entry's fields, also after a reload.
        autocompleteApply(itemPath, collection, name, base) {
            if (!base) {
                const spec = specAtPath(itemPath);
                base = spec?.kind === "group" ? newItemOf(spec) : undefined;
            }
            transport.send({ type: "autocompleteApply", path: itemPath, collection, name, base });
        },
    };
}
