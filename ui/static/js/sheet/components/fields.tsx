// Form fields of Preact blocks. A field shows its signal and never writes it
// itself: an edit goes to actions.change, which writes the signal and sends
// the change. Each field sends from one event, with the value type the server
// stores. The DOM value is set from the signal in an effect, not through a
// value prop, so a re-render never touches what the player is typing.
import { Fragment, type ComponentChildren, type JSX, type Ref, type RefObject, type VNode } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";
import { effect, Signal, type ReadonlySignal } from "@preact/signals-core";
import { optionLabel, optionValue, type Option } from "../schema/constants";
import { resolvePath } from "../state/sync.js";
import { joinPath, usePath, useSheet } from "./context";

type Bindable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The state path of field `field` and its signal, if the state has one. */
function useFieldSignal(field: string): { path: string; sig: ReadonlySignal<unknown> | null } {
    const path = joinPath(usePath(), field);
    const node = resolvePath(path);
    return { path, sig: node instanceof Signal ? node : null };
}

/**
 * The value at state path `path`, undefined without a signal there. Read
 * during render, it re-renders the component when the value changes, e.g.
 * an entry whose type picks its fields, and when a batch creates the value,
 * e.g. the roll that autocomplete brings: resolving the path reads the
 * missing key.
 */
export function valueAt(path: string): unknown {
    const node = resolvePath(path);
    return node instanceof Signal ? node.value : undefined;
}

/** The value at state path `path` without subscribing to it. */
export function peekAt(path: string): unknown {
    const node = resolvePath(path);
    return node instanceof Signal ? node.peek() : undefined;
}

/** Whether the text at state path `path` is not blank; for hasContent of collapsibles. */
export const hasText = (path: string) => String(peekAt(path) ?? "").trim() !== "";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
    if (typeof ref === "function") ref(value);
    else if (ref) (ref as RefObject<T | null>).current = value;
}

/** Keeps the element in sync with the signal: `apply` runs on mount and on every change. */
function useBinding<E extends Bindable>(
    sig: ReadonlySignal<unknown> | null,
    apply: (el: E, value: unknown) => void,
    outerRef?: Ref<E>,
) {
    const ref = useRef<E | null>(null);
    const setRef = useCallback((el: E | null) => {
        ref.current = el;
        assignRef(outerRef, el);
    }, [outerRef]);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !sig) return;
        return effect(() => apply(el, sig.value));
    }, [sig]);

    return setRef;
}

interface EditProps<T> {
    /** Replaces sending the edit, e.g. a skill row sends its advances in one batch. */
    onEdit?: (value: T) => void;
}

/** What an edit of the field at `path` does: actions.change unless the owner handles it. */
function useEdit<T>(path: string, onEdit?: (value: T) => void): (value: T) => void {
    const { actions } = useSheet();
    return onEdit ?? (value => actions.change(path, value));
}

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function setText(el: Bindable, v: unknown): void {
    const s = text(v);
    if (el.value !== s) el.value = s;
}

/**
 * Writes a number unless the input already shows it or is mid-edit: "007"
 * and "1." show 7 and 1, and "-" is not a number yet (the browser reports an
 * empty value with validity.badInput).
 */
export function setNumber(el: HTMLInputElement, v: unknown): void {
    if (el.validity?.badInput) return;
    const current = el.value;
    if (current !== "") {
        const n = Number(current);
        // Browsers never hold a non-number here; keep an unparsed value as typed.
        if (Number.isNaN(n) || n === Number(v)) return;
    }
    const next = text(v);
    if (current !== next) el.value = next;
}

type InputAttrs = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "ref" | "type" | "value" | "checked" | "onInput" | "onChange">;

export interface FieldProps<T> extends InputAttrs, EditProps<T> {
    /** The last segment of the state path, also the element's data-id. */
    field: string;
    inputRef?: Ref<HTMLInputElement>;
}

export function TextField({ field, inputRef, readOnly, onEdit, ...rest }: FieldProps<string>) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, setText, inputRef);
    const edit = useEdit(path, onEdit);
    return (
        <input {...rest} ref={ref} type="text" data-id={field} readOnly={!canEdit || readOnly}
            onInput={e => edit(e.currentTarget.value)} />
    );
}

/** A number input. It sends null while it is empty or holds an unfinished number ("-"). */
export function NumberField({ field, inputRef, readOnly, onEdit, ...rest }: FieldProps<number | null>) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, setNumber, inputRef);
    const edit = useEdit(path, onEdit);
    // The browser keeps only a valid number or "" in the value, ".5" and "1e3" included.
    return (
        <input {...rest} ref={ref} type="number" data-id={field} readOnly={!canEdit || readOnly}
            onInput={e => edit(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))} />
    );
}

export function Checkbox({ field, inputRef, disabled, onEdit, ...rest }: FieldProps<boolean>) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding<HTMLInputElement>(sig, (el, v) => {
        if (el.checked !== !!v) el.checked = !!v;
    }, inputRef);
    const edit = useEdit(path, onEdit);
    return (
        <input {...rest} ref={ref} type="checkbox" data-id={field} disabled={!canEdit || disabled}
            onChange={e => edit(e.currentTarget.checked)} />
    );
}

type ReadonlyFieldProps = Omit<FieldProps<never>, "inputRef" | "value" | "onEdit"> & {
    type?: string;
    /** A value the component computes, shown instead of the state's signal at `field`. */
    value?: ReadonlySignal<unknown>;
};

/**
 * A computed value: readonly, out of the tab order and never focused. This is
 * not the read-only mode: it looks the same to every player.
 */
export function ReadonlyField({ field, class: cls, type = "text", value, ...rest }: ReadonlyFieldProps) {
    const { sig } = useFieldSignal(field);
    const ref = useBinding(value ?? sig, setText);
    return (
        <input
            {...rest}
            ref={ref}
            type={type}
            data-id={field}
            class={cls ? `uneditable ${cls}` : "uneditable"}
            readOnly
            tabIndex={-1}
            onMouseDown={e => e.preventDefault()}
            onFocus={e => e.currentTarget.blur()}
        />
    );
}

type TextAreaAttrs = Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "ref" | "value" | "onInput" | "onChange">;

export interface TextAreaProps extends TextAreaAttrs, EditProps<string> {
    field: string;
    textareaRef?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ field, textareaRef, readOnly, onEdit, ...rest }: TextAreaProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, setText, textareaRef);
    const edit = useEdit(path, onEdit);
    return (
        <textarea {...rest} ref={ref} data-id={field} readOnly={!canEdit || readOnly}
            onInput={e => edit(e.currentTarget.value)} />
    );
}

type SelectAttrs = Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "ref" | "value" | "onInput" | "onChange">;

export interface SelectProps extends SelectAttrs, EditProps<string | number> {
    field: string;
    /** The options; `children` instead when they need optgroups. */
    options?: readonly Option[];
    /** Sends the value as a number: the server keeps a number there. */
    numeric?: boolean;
}

export function Select({ field, options = [], numeric = false, disabled, children, onEdit, ...rest }: SelectProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, setText);
    const edit = useEdit(path, onEdit);
    return (
        <select {...rest} ref={ref} data-id={field} disabled={!canEdit || disabled}
            onChange={e => edit(numeric ? Number(e.currentTarget.value) : e.currentTarget.value)}>
            {children ?? options.map(o => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
        </select>
    );
}

export interface RadioGroupProps {
    field: string;
    options: readonly Option[];
    /** Class of each radio button. */
    class?: string;
    /** Wraps a radio button, e.g. into a label with the option's text. */
    renderOption?: (radio: VNode, value: string, label: string) => ComponentChildren;
}

const labelled = (radio: VNode, _value: string, label: string) => <label>{radio}{label}</label>;

/**
 * Radio buttons of one value. The group name is the state path, so groups
 * of different items never share it.
 */
export function RadioGroup({ field, options, class: cls = "custom-radio", renderOption = labelled }: RadioGroupProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const radios = useRef<(HTMLInputElement | null)[]>([]);
    const edit = useEdit<string>(path);

    useLayoutEffect(() => {
        if (!sig) return;
        return effect(() => {
            const v = text(sig.value);
            for (const el of radios.current) {
                if (el && el.checked !== (el.value === v)) el.checked = el.value === v;
            }
        });
    }, [sig]);

    return (
        <>
            {options.map((o, i) => {
                const radio = (
                    <input
                        ref={el => { radios.current[i] = el; }}
                        type="radio"
                        class={cls}
                        data-id={field}
                        name={path}
                        value={optionValue(o)}
                        disabled={!canEdit}
                        onChange={e => edit(e.currentTarget.value)}
                    />
                );
                return <Fragment key={optionValue(o)}>{renderOption(radio, optionValue(o), optionLabel(o))}</Fragment>;
            })}
        </>
    );
}
