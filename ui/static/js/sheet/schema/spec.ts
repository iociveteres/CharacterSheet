// Building blocks of the sheet schema.
//
// The schema describes every field of the sheet: which control shows it and
// what an empty or missing value turns into. Value types are those of the
// control, as the sheet has always kept them: a text input holds a string even
// when the Go field is a number.

import type { Position } from "./content.gen";
import { optionValue, optionValues, type Option } from "./constants";

export type Scalar = string | number | boolean;

/** The form control a field is rendered with. It decides the value type. */
export type Control =
    | "text" // <input type="text">: string, line breaks are stripped
    | "textarea" // string, line breaks normalized to \n
    | "hidden" // <input type="hidden">: string as is
    | "number" // <input type="number">: number, invalid input reads as 0
    | "checkbox" // boolean
    | "select" // string, one of options
    | "radio"; // string, one of options, or no signal when none is checked

export interface FieldSpec<T extends Scalar = Scalar> {
    readonly kind: "field";
    readonly control: Control;
    /** What a missing value shows as. */
    readonly default: T;
    /** What a new item starts with, when it is not the default. See newItemOf. */
    readonly initial?: T;
    /** A zero value ("" or 0) also shows as the default. */
    readonly emptyAsDefault?: boolean;
    /** Allowed values of a select or a radio group, in markup order. */
    readonly options?: readonly string[];
}

/** A read-only output of a computed signal. It has no stored value. */
export interface ComputedSpec {
    readonly kind: "computed";
    readonly type: "string" | "number";
}

export interface GroupSpec<F extends Fields = Fields> {
    readonly kind: "group";
    readonly fields: F;
    /** Rendered only when the value is present (e.g. `roll`). */
    readonly optional?: boolean;
}

/** An item grid: `{ items: { [id]: item }, layouts: { [id]: position } }`. */
export interface GridSpec<I extends GroupSpec = GroupSpec> {
    readonly kind: "grid";
    readonly item: I;
    /** Column count, as defaultCols in sheet_funcs.go. */
    readonly columns: number;
}

export type Spec = FieldSpec | ComputedSpec | GroupSpec | GridSpec;
export type Fields = { readonly [key: string]: Spec };

// ─── Builders ────────────────────────────────────────────────────────────────

/** Options every field builder takes. */
export interface FieldOptions<T extends Scalar> {
    /** What a new item starts with; the default otherwise. */
    initial?: T;
}

const withInitial = <T extends Scalar>({ initial }: FieldOptions<T>) => (initial === undefined ? {} : { initial });

export const text = (opts: FieldOptions<string> = {}): FieldSpec<string> => ({
    kind: "field",
    control: "text",
    default: "",
    ...withInitial(opts),
});

export const textarea = (opts: FieldOptions<string> = {}): FieldSpec<string> => ({
    kind: "field",
    control: "textarea",
    default: "",
    ...withInitial(opts),
});

export const hidden = (def = ""): FieldSpec<string> => ({ kind: "field", control: "hidden", default: def });

export const number = (
    def = 0,
    { emptyAsDefault = false, ...opts }: { emptyAsDefault?: boolean } & FieldOptions<number> = {},
): FieldSpec<number> => ({
    kind: "field",
    control: "number",
    default: def,
    ...(emptyAsDefault && { emptyAsDefault }),
    ...withInitial(opts),
});

export const checkbox = (opts: FieldOptions<boolean> = {}): FieldSpec<boolean> => ({
    kind: "field",
    control: "checkbox",
    default: false,
    ...withInitial(opts),
});

/**
 * A select. `def` is the option shown for an empty value. A value that
 * matches no option shows the first one, as nothing is marked selected.
 */
export const select = (
    options: readonly Option[],
    def: string = optionValue(options[0]),
    opts: FieldOptions<string> = {},
): FieldSpec<string> => ({
    kind: "field",
    control: "select",
    default: def,
    options: optionValues(options),
    ...withInitial(opts),
});

/** A radio group. An empty or unknown value checks nothing. */
export const radio = (options: readonly Option[]): FieldSpec<string> => ({
    kind: "field",
    control: "radio",
    default: "",
    options: optionValues(options),
});

export const computed = (type: "string" | "number" = "number"): ComputedSpec => ({ kind: "computed", type });

export const group = <F extends Fields>(fields: F): GroupSpec<F> => ({ kind: "group", fields });

export const optionalGroup = <F extends Fields>(fields: F): GroupSpec<F> & { readonly optional: true } => ({
    kind: "group",
    fields,
    optional: true,
});

export const grid = <I extends GroupSpec>(item: I, columns: number): GridSpec<I> => ({ kind: "grid", item, columns });

// ─── Normalized content type ─────────────────────────────────────────────────

export interface Grid<T> {
    items: { [id: string]: T };
    layouts: { [id: string]: Position };
}

type OptionalKeys<F extends Fields> = {
    [K in keyof F]: F[K] extends { optional: true } ? K : never;
}[keyof F];

type StoredKeys<F extends Fields> = {
    [K in keyof F]: F[K] extends ComputedSpec ? never : K;
}[keyof F];

type InferFields<F extends Fields> = {
    -readonly [K in Exclude<StoredKeys<F>, OptionalKeys<F>>]: Infer<F[K]>;
} & {
    -readonly [K in Extract<StoredKeys<F>, OptionalKeys<F>>]?: Infer<F[K]>;
};

/** The normalized value of a spec. Computed outputs are left out. */
export type Infer<S> =
    S extends FieldSpec<infer T> ? (T extends string ? string : T extends number ? number : boolean)
    : S extends GridSpec<infer I> ? Grid<Infer<I>>
    : S extends GroupSpec<infer F> ? InferFields<F>
    : never;
