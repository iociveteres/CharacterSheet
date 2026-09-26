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

    // Signal missing (field never saved) — create it in parent, whose
    // version valueAt follows meanwhile
    const segs = path.split(".");
    const leaf = segs.pop();
    const parentPath = segs.join(".");
    const parent = resolvePath(parentPath);
    if (parent && typeof parent === "object") {
        parent[leaf] = signal(value);
        bumpItemVersion(parentPath);
    }
}

// ─── Batch update ─────────────────────────────────────────────────────────────

export function updateSignalBatch(basePath, changes) {
    batch(() => {
        _updateSignalBatchRecursive(basePath, changes);
    });
}

function _updateSignalBatchRecursive(basePath, changes) {
    for (const [key, value] of Object.entries(changes)) {
        const path = `${basePath}.${key}`;
        const node = resolvePath(path);
        if (key === 'layouts' && node instanceof Signal) {
            // The server replaces a grid's layouts as a whole.
            node.value = { ...value };
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            _updateSignalBatchRecursive(path, value);
        } else {
            updateSignalAtPath(path, value);
        }
    }
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
    bumpItemVersion(gridPath);
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

    toNode[itemId] = fromNode[itemId];
    delete fromNode[itemId];

    removeItemPosition(fromPath, itemId);
    setItemPosition(toPath, itemId, toPosition);
    batch(() => {
        bumpItemVersion(fromPath);
        bumpItemVersion(toPath);
    });
}

/**
 * Remove a signal branch when an item is deleted.
 * path includes the item id: "meleeAttacks.items.melee-attack-xxx"
 */
export function deleteItemFromState(path) {
    const segs = path.split(".");
    const itemId = segs.pop();
    const parent = resolvePath(segs.join("."));
    if (parent) delete parent[itemId];
    const parentPath = path.split('.').slice(0, -1).join('.');
    removeItemPosition(parentPath, itemId);
    bumpItemVersion(parentPath);
}

// Nested grids whose changes must also bump a coarser key, because the
// computeds only track that key (e.g. buildEntryIndex reads
// 'conditions.list.items' but not each condition's entries grid).
// Preact grids read their own key (useItemIds), so every create, delete and
// move bumps both through this table.
const PARENT_VERSION_KEYS = [
    [/^(conditions|gear|cybernetics)\.list\.items\.[^.]+\.entries\.items$/, m => `${m[1]}.list.items`],
];

// Bump whenever items are added/removed from a tracked collection, or a
// batch adds a node to the plain object at the key (see valueAt)
const _itemVersions = {};
export function bumpItemVersion(gridPath) {
    const keys = [gridPath];
    for (const [pattern, parentKey] of PARENT_VERSION_KEYS) {
        const m = gridPath.match(pattern);
        if (m) keys.push(parentKey(m));
    }
    batch(() => {
        for (const key of keys) {
            if (!_itemVersions[key]) _itemVersions[key] = signal(0);
            _itemVersions[key].value++;
        }
    });
}

export function getItemVersion(gridPath) {
    if (!_itemVersions[gridPath]) _itemVersions[gridPath] = signal(0);
    return _itemVersions[gridPath];
}

export function resetItemVersions() {
    for (const key of Object.keys(_itemVersions)) {
        delete _itemVersions[key];
    }
}