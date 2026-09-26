// Batches, local and remote. They follow the server: ApplyBatch
// merges with jsonb ||, so every key of a batch replaces its value as a
// whole, a grid (e.g. entries) included. Values are normalized by the schema,
// so the state looks as it will after a reload.
import { batch, signal, Signal } from "@preact/signals-core";
import { specAtPath, specToSignals, type SignalTree } from "./fromJson";
import { normalizeValue } from "../schema/normalize";
import type { GridSpec, GroupSpec, Spec } from "../schema/spec";
import { attachItemComputeds } from "./itemComputeds.js";
import { bumpItemVersion, resolvePath } from "./sync.js";

type PlainObject = { [key: string]: unknown };

const isTree = (v: unknown): v is SignalTree =>
    v !== null && typeof v === "object" && !(v instanceof Signal);

const parentPath = (path: string) => path.slice(0, path.lastIndexOf("."));

// A node the batch creates bumps the version of its parent, which valueAt
// follows for a value the state does not have yet.
function writeField(parent: SignalTree, key: string, value: unknown, path: string): void {
    const node = parent[key];
    if (node instanceof Signal) node.value = value;
    else {
        parent[key] = signal(value);
        bumpItemVersion(parentPath(path));
    }
}

function writeGroup(node: SignalTree, spec: GroupSpec, value: PlainObject, path: string): void {
    for (const [key, field] of Object.entries(spec.fields)) {
        // An optional group missing from the value stays as it is.
        if (field.kind === "computed" || !(key in value)) continue;
        write(node, key, field, value[key], `${path}.${key}`);
    }
}

function write(parent: SignalTree, key: string, spec: Spec, value: unknown, path: string): void {
    switch (spec.kind) {
        case "field":
            writeField(parent, key, value, path);
            break;
        case "group": {
            if (!isTree(parent[key])) {
                parent[key] = {};
                bumpItemVersion(parentPath(path));
            }
            writeGroup(parent[key] as SignalTree, spec, value as PlainObject, path);
            break;
        }
        case "grid":
            replaceGrid(parent, key, spec, value, path);
            break;
    }
}

function replaceGrid(parent: SignalTree, key: string, spec: GridSpec, value: unknown, path: string): void {
    if (!isTree(parent[key])) {
        parent[key] = {};
        bumpItemVersion(parentPath(path));
    }
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
 * Replaces the item at `path` with `value`, as the server writes an
 * autocomplete result: keys missing from `value` take the schema's defaults.
 * An optional group missing from `value` stays until a reload; one that
 * `value` brings is created, and components reading it re-render.
 */
export function replaceItemInState(path: string, value: PlainObject): void {
    const spec = specAtPath(path);
    if (spec?.kind !== "group") return;
    applyBatchToState(path, normalizeValue(spec, value, path) as PlainObject);
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
            write(node, key, field, normalizeValue(field, raw, childPath), childPath);
        }
    });
}
