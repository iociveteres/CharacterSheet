import { Signal, signal, batch } from "@preact/signals-core";
import { characterState } from "./state.js";
import { domToSignals } from "./builder.js";
import { getRoot } from "../utils.js";
import { specAtPath } from "./fromJson";
import { TechPower } from "../elements/tech.js";
import { CustomSkill } from "../elements/skills.js";
import { PsychicPower } from "../elements/psychic.js";
import { ExperienceItem } from "../elements/experience.js";
import { MeleeAttack } from "../elements/meleeAttack.js";
import { RangedAttack } from "../elements/rangedAttack.js";

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

    // Signal missing (field never saved) — create it in parent
    const segs = path.split(".");
    const leaf = segs.pop();
    const parent = resolvePath(segs.join("."));
    if (parent && typeof parent === "object") {
        parent[leaf] = signal(value);
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
// ─── Item computed attachment registry ───────────────────────────────────────

const ATTACH_REGISTRY = {
    'rangedAttacks.list.items': RangedAttack.attachComputeds,
    'meleeAttacks.list.items': MeleeAttack.attachComputeds,
    'customSkills.list.items': CustomSkill.attachComputeds,
    'experience.experienceLog.items': ExperienceItem.attachComputeds,
};

function attachItemComputeds(gridPath, itemId) {
    const attachFn = ATTACH_REGISTRY[gridPath];
    if (attachFn) {
        attachFn(itemId);
        return;
    }

    const psychicMatch = gridPath.match(/^psykana\.tabs\.items\.([^.]+)\.powers\.items$/);
    if (psychicMatch) {
        PsychicPower.attachComputeds(psychicMatch[1], itemId);
        return;
    }

    const techMatch = gridPath.match(/^technoArcana\.tabs\.items\.([^.]+)\.powers\.items$/);
    if (techMatch) {
        TechPower.attachComputeds(techMatch[1], itemId);
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

/**
 * Gives the grids nested in a new item (e.g. condition entries) the shape
 * jsonToSignals builds: an items object and a layouts signal taken from init.
 */
function addNestedGrids(itemNode, itemPath, init) {
    const spec = specAtPath(itemPath);
    if (spec?.kind === 'group') addGroupGrids(spec, itemNode, init);
}

function addGroupGrids(spec, node, init) {
    for (const [key, field] of Object.entries(spec.fields)) {
        if (field.kind === 'group') {
            if (node[key] && typeof node[key] === 'object') addGroupGrids(field, node[key], init?.[key]);
        } else if (field.kind === 'grid') {
            if (!node[key] || typeof node[key] !== 'object') node[key] = {};
            const grid = node[key];
            if (!grid.items || typeof grid.items !== 'object') grid.items = {};
            const positions = {};
            for (const [id, pos] of Object.entries(init?.[key]?.layouts ?? {})) {
                if (id in grid.items) positions[id] = pos;
            }
            grid.layouts = signal(positions);
            for (const [id, item] of Object.entries(grid.items)) {
                addGroupGrids(field.item, item, init?.[key]?.items?.[id]);
            }
        }
    }
}

// ─── Item lifecycle ───────────────────────────────────────────────────────────

/**
 * Wire signals for a newly created item.
 * Prefers scanning the live DOM element (full defaults) over the sparse init object.
 * itemPos, when given, is stored in the grid's layouts.
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
    const itemsNode = node;

    const el = getRoot()?.querySelector(`[data-id="${itemId}"]`);
    if (el) {
        const fullTree = domToSignals(el);
        const itemSegs = [...segs, itemId];
        const itemSubtree = itemSegs.reduce((cur, seg) => cur?.[seg] ?? null, fullTree);
        itemsNode[itemId] = itemSubtree ?? fullTree;
        addNestedGrids(itemsNode[itemId], `${gridPath}.${itemId}`, init);
    }
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
const PARENT_VERSION_KEYS = [
    [/^(conditions|gear|cybernetics)\.list\.items\.[^.]+\.entries\.items$/, m => `${m[1]}.list.items`],
];

// Bump whenever items are added/removed from a tracked collection
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