// Batches for blocks that Preact renders. They follow the server: ApplyBatch
// merges with jsonb ||, so every key of a batch replaces its value as a
// whole, a grid (e.g. entries) included. Values are normalized by the schema,
// so the state looks as it will after a reload.
import { batch, signal, Signal } from "@preact/signals-core";
import { specAtPath, specToSignals, type SignalTree } from "./fromJson";
import { normalizeValue } from "../schema/normalize";
import type { GridSpec, GroupSpec, Spec } from "../schema/spec";
import { attachItemComputeds, bumpItemVersion, resolvePath } from "./sync.js";
import { factoryFor } from "../factories";

type PlainObject = { [key: string]: unknown };

const isTree = (v: unknown): v is SignalTree =>
    v !== null && typeof v === "object" && !(v instanceof Signal);

function writeField(parent: SignalTree, key: string, value: unknown): void {
    const node = parent[key];
    if (node instanceof Signal) node.value = value;
    else parent[key] = signal(value);
}

function writeGroup(node: SignalTree, spec: GroupSpec, value: PlainObject, path: string, keepGrids: boolean): void {
    for (const [key, field] of Object.entries(spec.fields)) {
        // An optional group missing from the value stays as it is.
        if (field.kind === "computed" || !(key in value)) continue;
        write(node, key, field, value[key], `${path}.${key}`, keepGrids);
    }
}

function write(parent: SignalTree, key: string, spec: Spec, value: unknown, path: string, keepGrids: boolean): void {
    switch (spec.kind) {
        case "field":
            writeField(parent, key, value);
            break;
        case "group": {
            if (!isTree(parent[key])) parent[key] = {};
            writeGroup(parent[key] as SignalTree, spec, value as PlainObject, path, keepGrids);
            break;
        }
        case "grid":
            if (!keepGrids) replaceGrid(parent, key, spec, value, path);
            break;
    }
}

function replaceGrid(parent: SignalTree, key: string, spec: GridSpec, value: unknown, path: string): void {
    if (!isTree(parent[key])) parent[key] = {};
    const node = parent[key] as SignalTree;
    const fresh = specToSignals(spec, value) as SignalTree;

    // The items object stays the same, only its entries change.
    if (!isTree(node.items)) node.items = {};
    const items = node.items as SignalTree;
    for (const id of Object.keys(items)) delete items[id];
    Object.assign(items, fresh.items);

    const layouts = (fresh.layouts as Signal<unknown>).value;
    if (node.layouts instanceof Signal) node.layouts.value = layouts;
    else node.layouts = fresh.layouts;

    const gridPath = `${path}.items`;
    for (const id of Object.keys(items)) attachItemComputeds(gridPath, id);
    bumpItemVersion(gridPath);
}

/**
 * Applies a batch to the item or group at `path`. Keys the schema does not
 * know are ignored, as normalizeSheet drops them on reload.
 */
export function applyBatchToState(path: string, changes: PlainObject): void {
    const spec = specAtPath(path);
    const node = resolvePath(path);
    if (spec?.kind !== "group" || !isTree(node)) return;

    batch(() => {
        for (const [key, raw] of Object.entries(changes)) {
            const field = spec.fields[key];
            if (!field || field.kind === "computed") continue;
            const childPath = `${path}.${key}`;
            write(node, key, field, normalizeValue(field, raw, childPath), childPath, false);
        }
    });
}

/**
 * Sets the fields of the item at `itemPath` to what its factory creates, as
 * autocompleteApplied does before its batch. Nested grids stay: the factory
 * would give each client its own entry ids, and a batch that carries a grid
 * replaces it anyway.
 */
export function resetItemToFactory(itemPath: string): void {
    const spec = specAtPath(itemPath);
    const node = resolvePath(itemPath);
    if (spec?.kind !== "group" || !isTree(node)) return;

    const gridPath = itemPath.slice(0, itemPath.lastIndexOf("."));
    const init = factoryFor(gridPath)?.() ?? {};
    const value = normalizeValue(spec, init, itemPath) as PlainObject;
    batch(() => writeGroup(node, spec, value, itemPath, true));
}
