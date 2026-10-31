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
    /**
     * `base` is the item the entry is laid over; a new item of the schema by default. `rating` is the X of the Natural
     * Weapons trait a melee entry is a profile of: the server puts it into the damage as a modifier.
     */
    autocompleteApply(itemPath: string, collection: string, name: string, base?: object, rating?: string): void;
    /**
     * Sends a 360×480 WebP or JPEG portrait. It resolves once the server has
     * it and rejects with a message to show; the hash comes to every tab, this
     * one too, in portraitChanged (remote.ts), so all of them show the same.
     */
    uploadPortrait(image: Blob): Promise<void>;
    /** Removes the portrait; it goes from the sheet with portraitChanged, as uploadPortrait. */
    deletePortrait(): Promise<void>;
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
    uploadPortrait: () => Promise.resolve(),
    deletePortrait: () => Promise.resolve(),
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
    /** A request to the sheet's portrait: PUT with the image or DELETE; rejects with a message to show. */
    portrait(method: "PUT" | "DELETE", image?: Blob): Promise<void>;
}

/** The actions of the sheet whose state is `state`; `kind` is its kind as the server names it. */
export function createSheetActions(state: SheetSignals, kind: string, transport: Transport): SheetActions {
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
        autocompleteApply(itemPath, collection, name, base, rating) {
            if (!base) {
                const spec = specAtPath(schemaOf(state), itemPath);
                base = spec?.kind === "group" ? newItemOf(spec) : undefined;
            }
            transport.send({ type: "autocompleteApply", path: itemPath, kind, collection, name, base, ...(rating ? { rating } : {}) });
        },

        uploadPortrait: image => transport.portrait("PUT", image),
        deletePortrait: () => transport.portrait("DELETE"),
    };
}
