import { deepSignal } from "deepsignal/core";
import { computed, Signal, type ReadonlySignal } from "@preact/signals-core";
import { normalizeSheet } from "../schema/normalize";
import { statsOfSchema, type SheetSignals } from "../schema/sheet";
import type { StatSet } from "../schema/constants";
import type { GroupSpec } from "../schema/spec";
import { jsonToSignals } from "./fromJson";

// The schema each state was built with: the path lookups read it, and sheets
// of different kinds can live on one page.
const schemas = new WeakMap<SheetSignals, GroupSpec>();

// Two copies of signals-core make two reactive graphs that never notify each
// other, and nothing fails: the sheet just stops updating. check:signals
// catches it in npm; this catches a bundle that got one anyway.
if (__DEV__ && !(deepSignal({ probe: 0 }).$probe instanceof Signal)) {
    console.error("deepsignal uses another copy of @preact/signals-core: the sheet will not update. Run npm run check:signals.");
}

/**
 * The state of a sheet from content normalized by `schema`, without the
 * computeds of its kind. The objects of the tree are deepsignal proxies:
 * reading a key, or the keys of an object, subscribes to it, so adding and
 * removing items notifies the readers. The leaves are signals of their own.
 * Write through the tree: a raw object changed behind its proxy stays stale
 * for readers, and `in` does not subscribe.
 */
export function buildState(schema: GroupSpec, content: unknown): SheetSignals {
    const state = deepSignal({}) as SheetSignals;
    Object.assign(state, jsonToSignals(schema, content as never));
    schemas.set(state, schema);
    return state;
}

/** What the state takes of a sheet kind (kinds/kind.ts SheetKindDef). */
export interface StateKind {
    schema: GroupSpec;
    /** Places the computed outputs into the state built from `schema`. */
    attachComputeds(state: SheetSignals): void;
}

/**
 * The state of a sheet from its content as the server stores it, with the
 * computeds of its kind attached.
 */
export function createState(kind: StateKind, rawContent: unknown): SheetSignals {
    const ghosts: string[] = [];
    const content = normalizeSheet(kind.schema, rawContent, {
        onGhost: (gridPath, id) => ghosts.push(`${gridPath}.${id}`),
    });
    if (__DEV__ && ghosts.length) console.warn("normalizeSheet: dropped layouts of missing items", ghosts);

    const state = buildState(kind.schema, content);
    kind.attachComputeds(state);
    return state;
}

/** The schema `state` was built with. */
export function schemaOf(state: SheetSignals): GroupSpec {
    const schema = schemas.get(state);
    if (!schema) throw new Error("No schema: build the state with buildState or createState");
    return schema;
}

/** Places computed outputs on a grid item of `state` at `path`. */
export type ItemComputed = (state: SheetSignals, item: never, path: string) => void;
export type ItemComputeds = { readonly [gridPath: string]: ItemComputed | undefined };

// Added by the topics' attach…Computeds: the state code that creates items
// attaches them without importing the rules that compute them.
const itemComputeds = new WeakMap<SheetSignals, ItemComputeds>();

/** Adds `computeds` to those of `state` and attaches them to the items of their grids there now. */
export function addItemComputeds(state: SheetSignals, computeds: ItemComputeds): void {
    itemComputeds.set(state, { ...itemComputeds.get(state), ...computeds });
    for (const gridPath of Object.keys(computeds)) {
        const items = (gridPath.split(".").reduce<unknown>((node, seg) => (node as Record<string, unknown> | undefined)?.[seg], state) ?? {}) as Record<string, unknown>;
        for (const id of Object.keys(items)) attachItemComputeds(state, gridPath, id, items[id]);
    }
}

/** Attaches the computed outputs of `item`, the item `itemId` of the grid at `gridPath`, if it has any. */
export function attachItemComputeds(state: SheetSignals, gridPath: string, itemId: string, item: unknown): void {
    const attach = itemComputeds.get(state)?.[gridPath];
    if (attach && item && typeof item === "object") attach(state, item as never, `${gridPath}.${itemId}`);
}

/** The characteristics and skills of the kind of `state`, for state code that has no sheet context. */
export function statsOf(state: SheetSignals): StatSet {
    const stats = statsOfSchema(schemaOf(state));
    if (!stats) throw new Error("No stats: build the state with the schema of a kind (sheetSchemaOf)");
    return stats;
}

/**
 * A computed of `fn` for each sheet state, which all its readers share; it
 * goes with the state.
 */
export function sheetComputed<T>(fn: (state: SheetSignals) => T): (state: SheetSignals) => T {
    const computeds = new WeakMap<SheetSignals, ReadonlySignal<T>>();
    return state => {
        let c = computeds.get(state);
        if (!c) {
            c = computed(() => fn(state));
            computeds.set(state, c);
        }
        return c.value;
    };
}
