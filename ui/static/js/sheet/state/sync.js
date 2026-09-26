import { Signal, signal, batch } from "@preact/signals-core";
import { characterState } from "./state.js";
import { itemToSignals } from "./fromJson";
import { attachItemComputeds } from "./itemComputeds.js";

// ─── Path resolution ──────────────────────────────────────────────────────────

export function resolvePath(path) {
    if (!path) return null;
    return path.split(".").reduce((cur, seg) => cur?.[seg] ?? null, characterState);
}

// ─── Single value update ──────────────────────────────────────────────────────

export function updateSignalAtPath(path, value) {
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
    const leaf = segs.pop();
    const parent = resolvePath(segs.join("."));
    if (parent && typeof parent === "object") parent[leaf] = signal(value);
}

// ─── Layouts ──────────────────────────────────────────────────────────────────
// Every grid keeps its item positions in a signal next to its items:
// "conditions.list.items" → "conditions.list.layouts". They change wherever the
// server's layouts change: on create, delete, move and positionsChanged.

function layoutsSignal(gridPath) {
    const segs = gridPath.split('.');
    if (segs.pop() !== 'items') return null;
    const parent = resolvePath(segs.join('.'));
    if (!parent || typeof parent !== 'object' || parent instanceof Signal) return null;
    if (!(parent.layouts instanceof Signal)) parent.layouts = signal({});
    return parent.layouts;
}

/** Replaces the positions of a grid, as positionsChanged does. */
export function setLayouts(gridPath, positions) {
    const layouts = layoutsSignal(gridPath);
    if (layouts) layouts.value = { ...positions };
}

function setItemPosition(gridPath, itemId, pos) {
    const layouts = layoutsSignal(gridPath);
    if (!layouts || !pos) return;
    layouts.value = { ...layouts.value, [itemId]: { colIndex: pos.colIndex, rowIndex: pos.rowIndex } };
}

function removeItemPosition(gridPath, itemId) {
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
export function createItemInState(gridPath, itemId, init, itemPos) {
    batch(() => {
        // Ensure all intermediate plain-object nodes exist
        const segs = gridPath.split('.');
        let node = characterState;
        for (const seg of segs) {
            if (!node[seg] || typeof node[seg] !== 'object' || node[seg] instanceof Signal) {
                node[seg] = {};
            }
            node = node[seg];
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
export function moveItemInState(fromPath, toPath, itemId, toPosition) {
    const fromSegs = fromPath.split('.');
    const fromNode = fromSegs.reduce((c, s) => c?.[s] ?? null, characterState);
    if (!fromNode?.[itemId]) return;

    // Ensure destination path exists
    const toSegs = toPath.split('.');
    let toNode = characterState;
    for (const seg of toSegs) {
        if (!toNode[seg] || typeof toNode[seg] !== 'object') toNode[seg] = {};
        toNode = toNode[seg];
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
export function deleteItemFromState(path) {
    const segs = path.split(".");
    const itemId = segs.pop();
    const parentPath = segs.join(".");
    const parent = resolvePath(parentPath);
    batch(() => {
        if (parent) delete parent[itemId];
        removeItemPosition(parentPath, itemId);
    });
}
