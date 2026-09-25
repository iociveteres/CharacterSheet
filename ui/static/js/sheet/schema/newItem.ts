// What a new item holds before anyone edits it. It is sparse: a missing key
// shows the schema's default wherever the item is read (normalizeSheet), so
// only fields whose initial value differs from the default are written.

import type { GroupSpec, Infer } from "./spec";

/** A new item of `G`: the fields that start other than their default. */
export type NewItem<G extends GroupSpec> = Sparse<Infer<G>>;

type Sparse<T> = { [K in keyof T]?: T[K] extends object ? Sparse<T[K]> : T[K] };

/**
 * A new item of `spec`, e.g. `{ enabled: true, stacks: 1 }` for a condition.
 * Groups are kept only when a field inside starts other than its default;
 * grids and optional groups are left out and start empty.
 */
export function newItemOf<G extends GroupSpec>(spec: G): NewItem<G> {
    const out: { [key: string]: unknown } = {};
    for (const [key, field] of Object.entries(spec.fields)) {
        if (field.kind === "field" && field.initial !== undefined) {
            out[key] = field.initial;
        } else if (field.kind === "group" && !field.optional) {
            const group = newItemOf(field);
            if (Object.keys(group).length > 0) out[key] = group;
        }
    }
    return out as NewItem<G>;
}
