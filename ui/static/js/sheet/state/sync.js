import { signal, batch } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { characterState } from "./state.js";
import { domToSignals } from "./builder.js";
import { getRoot } from "../utils.js";
import { RangedAttack, MeleeAttack, CustomSkill, PsychicPower, TechPower } from "../elements.js";

// ─── Path resolution ──────────────────────────────────────────────────────────

export function resolvePath(path) {
    if (!path) return null;
    return path.split(".").reduce((cur, seg) => cur?.[seg] ?? null, characterState);
}

// ─── Single value update ──────────────────────────────────────────────────────

export function updateSignalAtPath(path, value) {
    const node = resolvePath(path);

    // Signal exists — write it
    if (node !== null && node?.brand !== undefined) {
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
        for (const [key, value] of Object.entries(changes)) {
            updateSignalAtPath(`${basePath}.${key}`, value);
        }
    });
}

// ─── Item computed attachment registry ───────────────────────────────────────

const ATTACH_REGISTRY = {
    'rangedAttacks.items': RangedAttack.attachComputeds,
    'meleeAttacks.items': MeleeAttack.attachComputeds,
    'customSkills.items': CustomSkill.attachComputeds,
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

// ─── Item lifecycle ───────────────────────────────────────────────────────────

/**
 * Wire signals for a newly created item.
 * Prefers scanning the live DOM element (full defaults) over the sparse init object.
 */
export function createItemInState(gridPath, itemId, init) {
    // Ensure all intermediate plain-object nodes exist
    const segs = gridPath.split('.');
    let node = characterState;
    for (const seg of segs) {
        if (!node[seg] || typeof node[seg] !== 'object' || node[seg].brand !== undefined) {
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
    }

    attachItemComputeds(gridPath, itemId);
    bumpItemVersion(gridPath);
}

/**
 * Change a signal branch when an item is moved
 */
export function moveItemInState(fromPath, toPath, itemId) {
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
    bumpItemVersion(parentPath);
}

// Bump whenever items are added/removed from a tracked collection
const _itemVersions = {};
export function bumpItemVersion(gridPath) {
    if (!_itemVersions[gridPath]) _itemVersions[gridPath] = signal(0);
    _itemVersions[gridPath].value++;
}
export function getItemVersion(gridPath) {
    if (!_itemVersions[gridPath]) _itemVersions[gridPath] = signal(0);
    return _itemVersions[gridPath];
}