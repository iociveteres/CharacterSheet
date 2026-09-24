import { signal, type Signal } from "@preact/signals-core";
import { sheetSchema, type SheetState } from "../schema/sheet";
import type { GridSpec, GroupSpec, Spec } from "../schema/spec";

/** Plain objects with signals at the leaves, the shape of characterState. */
export interface SignalTree {
    [key: string]: SignalTree | Signal<unknown>;
}

type PlainObject = { [key: string]: unknown };

function groupToSignals(spec: GroupSpec, value: PlainObject): SignalTree {
    const out: SignalTree = {};
    for (const [key, field] of Object.entries(spec.fields)) {
        if (field.kind === "computed") continue; // attachComputeds() places these
        const v = value[key];
        if (v === undefined) continue; // an optional group that is absent
        // With no radio button checked, domToSignals creates no signal either.
        if (field.kind === "field" && field.control === "radio" && !field.options?.includes(v as string)) continue;
        out[key] = specToSignals(field, v);
    }
    return out;
}

function gridToSignals(spec: GridSpec, value: PlainObject): SignalTree {
    const items: SignalTree = {};
    for (const [id, item] of Object.entries(value.items as PlainObject)) {
        items[id] = groupToSignals(spec.item, item as PlainObject);
    }
    return { items, layouts: signal({ ...(value.layouts as PlainObject) }) };
}

function specToSignals(spec: Spec, value: unknown): SignalTree | Signal<unknown> {
    switch (spec.kind) {
        case "group": return groupToSignals(spec, value as PlainObject);
        case "grid": return gridToSignals(spec, value as PlainObject);
        default: return signal(value);
    }
}

/**
 * Builds the signal tree from normalized content. It has the shape
 * domToSignals builds from the rendered markup, plus a `layouts` signal next
 * to the `items` of every grid.
 */
export function jsonToSignals(state: SheetState): SignalTree {
    return groupToSignals(sheetSchema, state as unknown as PlainObject);
}

/** The schema node at a dot path of the state, or null when the schema has none. */
export function specAtPath(path: string): Spec | null {
    let spec: Spec = sheetSchema;
    const segs = path.split(".");
    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (spec.kind === "group") {
            const next: Spec | undefined = spec.fields[seg];
            if (!next) return null;
            spec = next;
        } else if (spec.kind === "grid") {
            // <grid>.items.<id>.<field>
            if (seg !== "items" || i + 1 >= segs.length) return null;
            i++; // skip the item id
            spec = spec.item;
        } else {
            return null;
        }
    }
    return spec;
}
