// What a new item holds before anyone edits it. It differs from what
// normalizeSheet fills in for a missing key: a new condition has one stack,
// while a stored condition without stacks shows 0.

import type { GroupSpec, Infer, Spec } from "./spec";

function newValue(spec: Spec): unknown {
    switch (spec.kind) {
        case "field": return spec.initial ?? spec.default;
        case "group": return newItemOf(spec);
        case "grid": return { items: {}, layouts: {} };
        case "computed": return undefined;
    }
}

/**
 * A new item of `spec`: every field at its initial value, groups filled in,
 * grids empty. Optional groups are left out, as a new item has none.
 */
export function newItemOf<G extends GroupSpec>(spec: G): Infer<G> {
    const out: { [key: string]: unknown } = {};
    for (const [key, field] of Object.entries(spec.fields)) {
        if (field.kind === "computed" || (field.kind === "group" && field.optional)) continue;
        out[key] = newValue(field);
    }
    return out as Infer<G>;
}
