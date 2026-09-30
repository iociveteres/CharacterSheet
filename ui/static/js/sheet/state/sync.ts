import { Signal, signal, batch } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import type { SheetSignals } from "../schema/sheet";
import { schemaOf } from "./state";
import { itemToSignals } from "./fromJson";
import { attachItemComputeds } from "./itemComputeds";

/** An object of the state tree: a group, a grid or its items. */
type Tree = { [key: string]: unknown };
type Positions = { [id: string]: Position };

const isTree = (node: unknown): node is Tree =>
    node !== null && typeof node === "object" && !(node instanceof Signal);

// ─── Path resolution ──────────────────────────────────────────────────────────

/** The node at a dot path of the state: a signal, an object of the tree, or null. */
export function resolvePath(state: SheetSignals, path: string): unknown {
    if (!path) return null;
    return path.split(".").reduce<unknown>((cur, seg) => (cur as Tree | null)?.[seg] ?? null, state);
}

/**
 * The value at state path `path`, undefined without a signal there. Read in
 * a computed, it subscribes to it; during render, it re-renders the
 * component when the value changes, e.g.
 * an entry whose type picks its fields, and when a batch creates the value,
 * e.g. the roll that autocomplete brings: resolving the path reads the
 * missing key.
 */
export function valueAt(state: SheetSignals, path: string): unknown {
    const node = resolvePath(state, path);
    return node instanceof Signal ? node.value : undefined;
}

/** The value at state path `path` without subscribing to it. */
export function peekAt(state: SheetSignals, path: string): unknown {
    const node = resolvePath(state, path);
    return node instanceof Signal ? node.peek() : undefined;
}

/** The number at state path `path`, 0 for none or no number. Subscribes as valueAt. */
export const numberAt = (state: SheetSignals, path: string) => Number(valueAt(state, path)) || 0;

/** The text at state path `path`, "" for none. Subscribes as valueAt. */
export const textAt = (state: SheetSignals, path: string) => String(valueAt(state, path) ?? "");

// ─── Single value update ──────────────────────────────────────────────────────

export function updateSignalAtPath(state: SheetSignals, path: string, value: unknown): void {
    const node = resolvePath(state, path);

    // Signal exists — write it
    if (node instanceof Signal) {
        try { node.value = value; } catch { /* computed — ignore */ }
        return;
    }

    // Plain object node — not a writable leaf, ignore
    if (node !== null && typeof node === "object") return;

    // Signal missing (field never saved) — create it in parent; whoever read
    // the missing key re-renders, as the state tracks keys (deepsignal)
    const segs = path.split(".");
    const leaf = segs.pop()!;
    const parent = resolvePath(state, segs.join("."));
    if (parent && typeof parent === "object") (parent as Tree)[leaf] = signal(value);
}

// ─── Layouts ──────────────────────────────────────────────────────────────────
// Every grid keeps its item positions in a signal next to its items:
// "conditions.list.items" → "conditions.list.layouts". They change wherever the
// server's layouts change: on create, delete, move and positionsChanged.

function layoutsSignal(state: SheetSignals, gridPath: string): Signal<Positions> | null {
    const segs = gridPath.split('.');
    if (segs.pop() !== 'items') return null;
    const parent = resolvePath(state, segs.join('.'));
    if (!isTree(parent)) return null;
    if (!(parent.layouts instanceof Signal)) parent.layouts = signal({});
    return parent.layouts as Signal<Positions>;
}

/** Replaces the positions of a grid, as positionsChanged does. */
export function setLayouts(state: SheetSignals, gridPath: string, positions: Positions): void {
    const layouts = layoutsSignal(state, gridPath);
    if (layouts) layouts.value = { ...positions };
}

function setItemPosition(state: SheetSignals, gridPath: string, itemId: string, pos: Position | undefined): void {
    const layouts = layoutsSignal(state, gridPath);
    if (!layouts || !pos) return;
    layouts.value = { ...layouts.value, [itemId]: { colIndex: pos.colIndex, rowIndex: pos.rowIndex } };
}

function removeItemPosition(state: SheetSignals, gridPath: string, itemId: string): void {
    const layouts = layoutsSignal(state, gridPath);
    if (!layouts || !(itemId in layouts.value)) return;
    const { [itemId]: _, ...rest } = layouts.value;
    layouts.value = rest;
}

// ─── Item lifecycle ───────────────────────────────────────────────────────────

/**
 * Wire signals for a newly created item: the item is built from init, the
 * object of its factory, with the schema's defaults. itemPos, when given, is
 * stored in the grid's layouts.
 */
export function createItemInState(state: SheetSignals, gridPath: string, itemId: string, init: unknown, itemPos?: Position): void {
    batch(() => {
        // Ensure all intermediate plain-object nodes exist
        const segs = gridPath.split('.');
        let node = state as Tree;
        for (const seg of segs) {
            if (!isTree(node[seg])) node[seg] = {};
            node = node[seg] as Tree;
        }

        const tree = itemToSignals(schemaOf(state), gridPath, init);
        if (tree) node[itemId] = tree;
        setItemPosition(state, gridPath, itemId, itemPos);

        attachItemComputeds(state, gridPath, itemId);
    });
}

/**
 * Change a signal branch when an item is moved
 */
export function moveItemInState(state: SheetSignals, fromPath: string, toPath: string, itemId: string, toPosition: Position): void {
    const fromNode = resolvePath(state, fromPath) as Tree | null;
    if (!fromNode?.[itemId]) return;

    // Ensure destination path exists
    const toSegs = toPath.split('.');
    let toNode = state as Tree;
    for (const seg of toSegs) {
        if (!toNode[seg] || typeof toNode[seg] !== 'object') toNode[seg] = {};
        toNode = toNode[seg] as Tree;
    }

    batch(() => {
        toNode[itemId] = fromNode[itemId];
        delete fromNode[itemId];

        removeItemPosition(state, fromPath, itemId);
        setItemPosition(state, toPath, itemId, toPosition);
    });
}

/**
 * Remove a signal branch when an item is deleted.
 * path includes the item id: "meleeAttacks.items.melee-attack-xxx"
 */
export function deleteItemFromState(state: SheetSignals, path: string): void {
    const segs = path.split(".");
    const itemId = segs.pop()!;
    const parentPath = segs.join(".");
    const parent = resolvePath(state, parentPath) as Tree | null;
    batch(() => {
        if (parent) delete parent[itemId];
        removeItemPosition(state, parentPath, itemId);
    });
}
