// Local structural edits of the blocks that Preact renders. Each one changes
// the state and sends the message old blocks send for the same edit.
// network.js builds the instance: it stays the one writer of the state, and
// components reach it through the sheet context.
import type { Position } from "../schema/content.gen";
import { newItemOf } from "../schema/newItem";
import { specAtPath } from "./fromJson";
import { createItemInState, deleteItemFromState, moveItemInState, setLayouts, updateSignalAtPath } from "./sync.js";

export type Positions = { [id: string]: Position };

export interface SheetActions {
    /** A field edit that no input event reports, e.g. the result of an initiative roll. */
    change(path: string, value: unknown): void;
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
