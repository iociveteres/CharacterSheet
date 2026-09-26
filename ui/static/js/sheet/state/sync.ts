import { Signal, signal, batch } from "@preact/signals-core";
import type { Position } from "../schema/content.gen";
import { characterState } from "./state";
import { itemToSignals } from "./fromJson";
import { attachItemComputeds } from "./itemComputeds.js";

/** An object of the state tree: a group, a grid or its items. */
type Tree = { [key: string]: unknown };
type Positions = { [id: string]: Position };

const isTree = (node: unknown): node is Tree =>
    node !== null && typeof node === "object" && !(node instanceof Signal);

// ─── Path resolution ──────────────────────────────────────────────────────────

/** The node at a dot path of the state: a signal, an object of the tree, or null. */
export function resolvePath(path: string): unknown {
    if (!path) return null;
    return path.split(".").reduce<unknown>((cur, seg) => (cur as Tree | null)?.[seg] ?? null, characterState);
}

// ─── Single value update ──────────────────────────────────────────────────────

export function updateSignalAtPath(path: string, value: unknown): void {
    const node = resolvePath(path);

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
    const parent = resolvePath(segs.join("."));
    if (parent && typeof parent === "object") (parent as Tree)[leaf] = signal(value);
}

// ─── Layouts ──────────────────────────────────────────────────────────────────
// Every grid keeps its item positions in a signal next to its items:
// "conditions.list.items" → "conditions.list.layouts". They change wherever the
// server's layouts change: on create, delete, move and positionsChanged.

function layoutsSignal(gridPath: string): Signal<Positions> | null {
    const segs = gridPath.split('.');
    if (segs.pop() !== 'items') return null;
    const parent = resolvePath(segs.join('.'));
    if (!isTree(parent)) return null;
    if (!(parent.layouts instanceof Signal)) parent.layouts = signal({});
    return parent.layouts as Signal<Positions>;
}

/** Replaces the positions of a grid, as positionsChanged does. */
export function setLayouts(gridPath: string, positions: Positions): void {
    const layouts = layoutsSignal(gridPath);
    if (layouts) layouts.value = { ...positions };
}

function setItemPosition(gridPath: string, itemId: string, pos: Position | undefined): void {
    const layouts = layoutsSignal(gridPath);
    if (!layouts || !pos) return;
    layouts.value = { ...layouts.value, [itemId]: { colIndex: pos.colIndex, rowIndex: pos.rowIndex } };
}

function removeItemPosition(gridPath: string, itemId: string): void {
    const layouts = layoutsSignal(gridPath);
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
export function createItemInState(gridPath: string, itemId: string, init: unknown, itemPos?: Position): void {
    batch(() => {
        // Ensure all intermediate plain-object nodes exist
        const segs = gridPath.split('.');
        let node = characterState as Tree;
        for (const seg of segs) {
            if (!isTree(node[seg])) node[seg] = {};
            node = node[seg] as Tree;
        }

        const tree = itemToSignals(gridPath, init);
        if (tree) node[itemId] = tree;
        setItemPosition(gridPath, itemId, itemPos);

        attachItemComputeds(gridPath, itemId);
    });
}

/**
 * Change a signal branch when an item is moved
 */
export function moveItemInState(fromPath: string, toPath: string, itemId: string, toPosition: Position): void {
    const fromNode = resolvePath(fromPath) as Tree | null;
    if (!fromNode?.[itemId]) return;

    // Ensure destination path exists
    const toSegs = toPath.split('.');
    let toNode = characterState as Tree;
    for (const seg of toSegs) {
        if (!toNode[seg] || typeof toNode[seg] !== 'object') toNode[seg] = {};
        toNode = toNode[seg] as Tree;
    }

    batch(() => {
        toNode[itemId] = fromNode[itemId];
        delete fromNode[itemId];

        removeItemPosition(fromPath, itemId);
        setItemPosition(toPath, itemId, toPosition);
    });
}

/**
 * Remove a signal branch when an item is deleted.
 * path includes the item id: "meleeAttacks.items.melee-attack-xxx"
 */
export function deleteItemFromState(path: string): void {
    const segs = path.split(".");
    const itemId = segs.pop()!;
    const parentPath = segs.join(".");
    const parent = resolvePath(parentPath) as Tree | null;
    batch(() => {
        if (parent) delete parent[itemId];
        removeItemPosition(parentPath, itemId);
    });
}
