// Remote sheet changes: they only change the state, the components render it.
// network.ts calls this for every sheet message of a sheet on the page.
import { batch, Signal } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import type { SheetSignals } from "../schema/sheet";
import type { DragFreeze } from "./dragFreeze";
import { applyBatchToState, replaceItemInState } from "./applyBatch";
import type { SheetUiState } from "./ui";
import {
    createItemInState, deleteItemFromState, moveItemInState, removeItemPosition, resolvePath, setItemPosition,
    setLayouts, updateSignalAtPath,
} from "./sync";
import { ABSENT, layoutOf, touches, type Part, type SheetVersions, type Sink } from "../versions";

type Positions = { [id: string]: Position };

/** `version` is what the write gave the sheet on the server; without it the change applies as it comes. */
export type RemoteSheetMessage = (
    | { type: "change"; path: string; change: unknown }
    | { type: "batch" | "autocompleteApplied"; path: string; changes: { [key: string]: unknown } }
    | { type: "createItem"; path: string; itemId: string; itemPos?: Position; init?: unknown }
    | { type: "deleteItem"; path: string }
    | { type: "positionsChanged"; path: string; positions: Positions }
    | { type: "moveItemBetweenGrids"; fromPath: string; toPath: string; itemId: string; toPosition: Position }
    | { type: "portraitChanged"; portrait: string | null }
) & { version?: number };

/**
 * What a remote change reaches: the sheet's state, its UI state, its frozen
 * grids, its portrait and the versions of what it shows (none in tests that
 * apply every change as it comes).
 */
export interface RemoteTarget {
    state: SheetSignals;
    ui: SheetUiState;
    freeze: DragFreeze;
    portrait: Signal<string | null>;
    versions?: SheetVersions;
}

type ContentMessage = Exclude<RemoteSheetMessage, { type: "portraitChanged" }>;

function applyToState({ state, ui }: RemoteTarget, msg: ContentMessage): void {
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

// — Versions ————————————————————————————

type Tree = { [key: string]: unknown };
const isTree = (node: unknown): node is Tree => node !== null && typeof node === "object" && !(node instanceof Signal);

function toJson(node: unknown): unknown {
    if (node instanceof Signal) return node.peek();
    if (isTree(node)) return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, toJson(child)]));
    return node;
}

/** The value at a content path as JSON, ABSENT when there is none; it reads into signals of objects, e.g. a position in layouts. */
export function readJson(state: SheetSignals, path: string): unknown {
    let node: unknown = state;
    for (const seg of path.split(".")) {
        if (node instanceof Signal) node = node.peek();
        if (node === null || typeof node !== "object" || !(seg in node)) return ABSENT;
        node = (node as Tree)[seg];
    }
    return toJson(node);
}

/** Whether there is a value at a content path, as readJson sees it. */
export function hasJson(state: SheetSignals, path: string): boolean {
    let node: unknown = state;
    for (const seg of path.split(".")) {
        if (node instanceof Signal) node = node.peek();
        if (node === null || typeof node !== "object" || !(seg in node)) return false;
        node = (node as Tree)[seg];
    }
    return true;
}

/**
 * Writes a value the versions held back, at any path: a position, the
 * layouts of a grid, an item, or a key of a group. A field written ABSENT
 * takes its default, as on reload.
 */
export function writeJson({ state }: RemoteTarget, { path, value }: Part): void {
    const segs = path.split(".");
    const key = segs.pop()!;
    const parent = segs.join(".");
    if (segs.at(-1) === "layouts") {
        const grid = [...segs.slice(0, -1), "items"].join(".");
        if (value === ABSENT) removeItemPosition(state, grid, key);
        else setItemPosition(state, grid, key, value as Position);
    } else if (key === "layouts") {
        setLayouts(state, parent ? `${parent}.items` : "items", value === ABSENT ? {} : value as Positions);
    } else if (segs.at(-1) === "items") {
        if (value === ABSENT) deleteItemFromState(state, path);
        else if (resolvePath(state, path)) replaceItemInState(state, path, value as Tree);
        else createItemInState(state, parent, key, value);
    } else if (parent) {
        applyBatchToState(state, parent, { [key]: value === ABSENT ? undefined : value });
    } else {
        updateSignalAtPath(state, path, value === ABSENT ? undefined : value);
    }
}

/** How the versions of `sheet` read its state and write the values they release. */
export function sinkOf(sheet: RemoteTarget): Sink {
    return {
        read: path => readJson(sheet.state, path),
        has: path => hasJson(sheet.state, path),
        write: part => sheet.freeze.runOrQueue([part.path], () => writeJson(sheet, part)),
    };
}

type PartMessage = Extract<ContentMessage, { type: "change" | "batch" | "autocompleteApplied" | "createItem" | "positionsChanged" }>;

/** The writes of a message, each at the path it replaces as a whole. */
function partsOf(msg: PartMessage): Part[] {
    switch (msg.type) {
        case "change":
            return [{ path: msg.path, value: msg.change }];
        case "batch":
            return Object.entries(msg.changes).map(([key, value]) => ({ path: `${msg.path}.${key}`, value }));
        case "autocompleteApplied":
            return [{ path: msg.path, value: msg.changes }];
        case "createItem": {
            const item = `${msg.path}.${msg.itemId}`;
            return [{ path: item, value: msg.init ?? {}, creates: true }, { path: layoutOf(item), value: msg.itemPos }];
        }
        case "positionsChanged":
            return [{ path: touches(msg)[0], value: msg.positions }];
    }
}

/** The message with only the parts the versions kept, null when none is left. */
function withParts(sheet: RemoteTarget, msg: PartMessage, parts: Part[]): ContentMessage | null {
    if (!parts.length) return null;
    const value = (path: string) => parts.find(p => p.path === path)?.value;
    switch (msg.type) {
        case "change":
            return { ...msg, change: parts[0].value };
        case "batch":
            return { ...msg, changes: Object.fromEntries(parts.map(p => [p.path.slice(msg.path.length + 1), p.value])) };
        case "autocompleteApplied":
            return { ...msg, changes: parts[0].value as Tree };
        case "positionsChanged":
            return { ...msg, positions: parts[0].value as Positions };
        case "createItem": {
            const item = `${msg.path}.${msg.itemId}`;
            if (parts.some(p => p.path === item)) {
                return { ...msg, init: value(item), itemPos: value(layoutOf(item)) as Position | undefined };
            }
            // The item lost to something newer, its position did not.
            writeJson(sheet, parts[0]);
            return null;
        }
    }
}

/** Applies what the versions of the sheet keep of `msg` (versions.ts has the rules). */
function applyVersioned(sheet: RemoteTarget, versions: SheetVersions, msg: ContentMessage, version: number): void {
    switch (msg.type) {
        case "deleteItem":
            if (versions.receiveItems([msg.path], version, { deleted: true })) applyToState(sheet, msg);
            return;
        case "moveItemBetweenGrids":
            if (versions.receiveItems([`${msg.fromPath}.${msg.itemId}`, `${msg.toPath}.${msg.itemId}`], version)) {
                applyToState(sheet, msg);
                versions.adopt(sinkOf(sheet));
            }
            return;
        default: {
            const sink = sinkOf(sheet);
            const kept = versions.receive(partsOf(msg), version, sink);
            const rest = withParts(sheet, msg, kept);
            if (rest) applyToState(sheet, rest);
            versions.adopt(sink);
        }
    }
}

/**
 * Applies a remote change to the state. While an item of a grid is dragged,
 * changes touching that grid wait; the versions judge them once they run.
 */
export function applyRemoteToState(sheet: RemoteTarget, msg: RemoteSheetMessage): void {
    // The portrait is not in the content, so no grid holds it back.
    if (msg.type === "portraitChanged") {
        sheet.portrait.value = msg.portrait;
        return;
    }
    const paths = msg.type === "moveItemBetweenGrids" ? [msg.fromPath, msg.toPath] : [msg.path];
    const { versions } = sheet;
    const { version } = msg;
    // A message without a version is applied as before the versions.
    if (versions && typeof version === "number") {
        sheet.freeze.runOrQueue(paths, () => applyVersioned(sheet, versions, msg, version));
    } else {
        sheet.freeze.runOrQueue(paths, () => applyToState(sheet, msg));
    }
}
