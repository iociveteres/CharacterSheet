import { deepSignal } from "deepsignal/core";
import { computed, type ReadonlySignal } from "@preact/signals-core";
import { normalizeSheet } from "../schema/normalize";
import type { SheetSignals } from "../schema/sheet";
import type { GroupSpec } from "../schema/spec";
import type { SheetKindDef } from "../kinds/kind";
import { jsonToSignals } from "./fromJson";

// The schema each state was built with: the path lookups read it, and sheets
// of different kinds can live on one page.
const schemas = new WeakMap<SheetSignals, GroupSpec>();

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

/**
 * The state of a sheet from its content as the server stores it, with the
 * computeds of its kind attached.
 */
export function createState(kind: SheetKindDef, rawContent: unknown): SheetSignals {
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
