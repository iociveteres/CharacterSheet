// Local structural edits of the blocks that Preact renders. Each one changes
// the state and sends the message old blocks send for the same edit.
// network.js builds the instance: it stays the one writer of the state, and
// components reach it through the sheet context.
import type { Position } from "../schema/content.gen";
import { createItemInState, deleteItemFromState, moveItemInState, setLayouts } from "./sync.js";

export type Positions = { [id: string]: Position };

export interface SheetActions {
    createItem(gridPath: string, itemId: string, init: object, itemPos: Position): void;
    deleteItem(itemPath: string): void;
    positionsChanged(gridPath: string, positions: Positions): void;
    moveItemBetweenGrids(fromPath: string, toPath: string, itemId: string, toPosition: Position): void;
    autocompleteApply(itemPath: string, collection: string, name: string): void;
}

/** How messages leave. network.js adds eventID and sheetID. */
export interface Transport {
    send(msg: object): void;
    /** Debounced by `key`, like field edits: only the last message in 200 ms goes. */
    schedule(msg: object, key: string): void;
}

export function createSheetActions(transport: Transport): SheetActions {
    return {
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

        autocompleteApply(itemPath, collection, name) {
            transport.send({ type: "autocompleteApply", path: itemPath, collection, name });
        },
    };
}
