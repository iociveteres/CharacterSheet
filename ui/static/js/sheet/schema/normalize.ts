// normalizeSheet turns stored sheet content into the shape of the schema:
// every field present, typed as its control reads it, with the defaults the
// templates show for empty values.

import { sheetSchema, type SheetState } from "./sheet";
import type { FieldSpec, GridSpec, GroupSpec, Scalar, Spec } from "./spec";

export interface NormalizeOptions {
    /**
     * Called for a layouts key that has no item. The template renders such a
     * key as an empty "ghost" item; normalizeSheet drops it. `gridPath` is the
     * items path, e.g. "conditions.list.items".
     */
    onGhost?: (gridPath: string, id: string) => void;
}

type PlainObject = { [key: string]: unknown };

const isPlainObject = (v: unknown): v is PlainObject =>
    v !== null && typeof v === "object" && !Array.isArray(v);

// A valid floating-point number, as an <input type="number"> accepts it.
const FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function toText(v: unknown): string {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "";
}

function toNumber(v: unknown): number {
    let n = 0;
    if (typeof v === "number") n = v;
    else if (typeof v === "string" && FLOAT.test(v)) n = Number(v);
    // `|| 0` also turns -0 into 0, as domToSignals does.
    return Number.isFinite(n) ? n || 0 : 0;
}

/** Normalizes one value the way its control shows it. */
export function normalizeField(spec: FieldSpec, raw: unknown): Scalar {
    const v = raw === undefined || raw === null ? spec.default : raw;

    switch (spec.control) {
        case "text": {
            // Browsers strip line breaks from a text input's value.
            const s = toText(v).replace(/[\r\n]/g, "");
            return spec.emptyAsDefault && s === "" ? spec.default : s;
        }
        case "textarea":
            return toText(v).replace(/\r\n?/g, "\n");
        case "hidden":
            return toText(v);
        case "number": {
            const n = toNumber(v);
            return spec.emptyAsDefault && n === 0 ? spec.default : n;
        }
        case "checkbox":
            return v === true;
        case "select": {
            const s = toText(v);
            const options = spec.options ?? [];
            if (options.includes(s)) return s;
            // Nothing is marked selected, so the browser shows the first option.
            return s === "" ? spec.default : (options[0] ?? "");
        }
        case "radio": {
            // An unknown value checks no radio button.
            const s = toText(v);
            return spec.options?.includes(s) ? s : "";
        }
    }
}

function normalizeGroup(spec: GroupSpec, raw: unknown, path: string, options: NormalizeOptions): PlainObject {
    const src = isPlainObject(raw) ? raw : {};
    const out: PlainObject = {};
    for (const [key, field] of Object.entries(spec.fields)) {
        if (field.kind === "computed") continue;
        if (field.kind === "group" && field.optional && !isPlainObject(src[key])) continue;
        out[key] = normalizeSpec(field, src[key], path ? `${path}.${key}` : key, options);
    }
    return out;
}

function normalizeGrid(spec: GridSpec, raw: unknown, path: string, options: NormalizeOptions): PlainObject {
    const src = isPlainObject(raw) ? raw : {};
    // Go writes nil maps as null.
    const rawItems = isPlainObject(src.items) ? src.items : {};
    const rawLayouts = isPlainObject(src.layouts) ? src.layouts : {};
    const itemsPath = `${path}.items`;

    const items: PlainObject = {};
    for (const [id, item] of Object.entries(rawItems)) {
        items[id] = normalizeGroup(spec.item, item, `${itemsPath}.${id}`, options);
    }

    const layouts: PlainObject = {};
    for (const [id, pos] of Object.entries(rawLayouts)) {
        if (!(id in items)) {
            options.onGhost?.(itemsPath, id);
            continue;
        }
        const p = isPlainObject(pos) ? pos : {};
        layouts[id] = { colIndex: toNumber(p.colIndex), rowIndex: toNumber(p.rowIndex) };
    }

    return { items, layouts };
}

function normalizeSpec(spec: Spec, raw: unknown, path: string, options: NormalizeOptions): unknown {
    switch (spec.kind) {
        case "field": return normalizeField(spec, raw);
        case "group": return normalizeGroup(spec, raw, path, options);
        case "grid": return normalizeGrid(spec, raw, path, options);
        case "computed": return undefined;
    }
}

const warnGhost = (gridPath: string, id: string) =>
    console.warn(`normalizeSheet: dropped layout of missing item ${gridPath}.${id}`);

/**
 * Fills in missing keys and fields from the schema, turns null maps into
 * objects, coerces values to the types their controls produce and drops
 * layouts keys without an item. Computed outputs and keys the schema does not
 * know are left out. Pure: `raw` is not modified.
 */
export function normalizeSheet(raw: unknown, options: NormalizeOptions = {}): SheetState {
    const opts = { onGhost: options.onGhost ?? (__DEV__ ? warnGhost : undefined) };
    return normalizeGroup(sheetSchema, raw, "", opts) as SheetState;
}
