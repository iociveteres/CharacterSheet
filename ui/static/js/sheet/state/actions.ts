// Local edits of the sheet. Each one changes the state and sends its message
// in the format the server has always taken. main.ts builds them for a sheet
// with the transport of network.ts; components reach them through the sheet context.
import type { Position } from "../schema/content.gen";
import type { SheetSignals } from "../schema/sheet";
import type { SheetRolls } from "../rollEvents";
import { newItemOf } from "../schema/newItem";
import { specAtPath } from "./fromJson";
import { schemaOf } from "./state";
import { applyBatchToState } from "./applyBatch";
import { createItemInState, deleteItemFromState, moveItemInState, setLayouts, updateSignalAtPath } from "./sync";

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

/** The actions of a sheet the viewer cannot edit now: they change nothing, so a roll from it only goes to the chat. */
export const VIEW_ONLY_ACTIONS: SheetActions = {
    change() {},
    batch() {},
    createItem() {},
    deleteItem() {},
    positionsChanged() {},
    moveItemBetweenGrids() {},
    autocompleteApply() {},
};

/** What a cast, an activation or a roll changes: the sheet's state through its actions, and its rolls. */
export interface SheetOps {
    state: SheetSignals;
    actions: SheetActions;
    rolls: SheetRolls;
}

/** How messages leave. network.ts adds eventID and sheetID. */
export interface Transport {
    send(msg: object): void;
    /** Debounced by `key`, like field edits: only the last message in 200 ms goes. */
    schedule(msg: object, key: string): void;
}

/** The actions of the sheet whose state is `state`. */
export function createSheetActions(state: SheetSignals, transport: Transport): SheetActions {
    return {
        change(path, value) {
            updateSignalAtPath(state, path, value);
            transport.schedule({ type: "change", path, change: value }, path);
        },

        batch(path, changes) {
            applyBatchToState(state, path, changes);
            transport.schedule({ type: "batch", path, changes }, path);
        },

        createItem(gridPath, itemId, init, itemPos) {
            createItemInState(state, gridPath, itemId, init, itemPos);
            transport.send({ type: "createItem", path: gridPath, itemId, itemPos, init });
        },

        deleteItem(itemPath) {
            deleteItemFromState(state, itemPath);
            transport.send({ type: "deleteItem", path: itemPath });
        },

        positionsChanged(gridPath, positions) {
            setLayouts(state, gridPath, positions);
            transport.schedule({ type: "positionsChanged", path: gridPath, positions }, gridPath);
        },

        moveItemBetweenGrids(fromPath, toPath, itemId, toPosition) {
            moveItemInState(state, fromPath, toPath, itemId, toPosition);
            transport.send({ type: "moveItemBetweenGrids", fromPath, toPath, itemId, toPosition });
        },

        // The server replaces the item with base || the collection entry, so
        // it becomes a new one with the entry's fields, also after a reload.
        autocompleteApply(itemPath, collection, name, base) {
            if (!base) {
                const spec = specAtPath(schemaOf(state), itemPath);
                base = spec?.kind === "group" ? newItemOf(spec) : undefined;
            }
            transport.send({ type: "autocompleteApply", path: itemPath, collection, name, base });
        },
    };
}
