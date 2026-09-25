// Form fields of Preact blocks. A field shows its signal and never writes it
// itself: an edit goes to actions.change, which writes the signal and sends
// the change. The DOM value is set from the signal in an effect, not through
// a value prop, so a re-render never touches what the player is typing.
import { Fragment, type ComponentChildren, type JSX, type Ref, type RefObject, type VNode } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";
import { effect, Signal, type ReadonlySignal } from "@preact/signals-core";
import { optionLabel, optionValue, type Option } from "../schema/constants";
import { resolvePath } from "../state/sync.js";
import { normalizeChange, type ChangeEventKind } from "../normalizeChange";
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
 * an entry whose type picks its fields.
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

type Handler<E extends EventTarget> = JSX.GenericEventHandler<E> | undefined;

interface EditProps<E extends EventTarget> {
    onInput?: Handler<E>;
    onChange?: Handler<E>;
    /** False when the owner sends the edit itself, as a skill row sends its advances in one batch. */
    sendEdits?: boolean;
}

/**
 * onInput and onChange of a field: the value normalizeChange reads from the
 * element goes to actions.change, then the caller's own handlers run.
 */
function useEditHandlers<E extends Bindable>(path: string, { onInput, onChange, sendEdits = true }: EditProps<E>) {
    const { actions } = useSheet();
    const handler = (kind: ChangeEventKind, own: Handler<E>) => (e: JSX.TargetedEvent<E, Event>) => {
        if (sendEdits) {
            const value = normalizeChange(e.currentTarget, kind);
            if (value !== undefined) actions.change(path, value);
        }
        own?.(e);
    };
    return { onInput: handler("input", onInput), onChange: handler("change", onChange) };
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

export interface FieldProps extends InputAttrs, EditProps<HTMLInputElement> {
    /** The last segment of the state path, also the element's data-id. */
    field: string;
    inputRef?: Ref<HTMLInputElement>;
}

export function TextField({ field, inputRef, readOnly, onInput, onChange, sendEdits, ...rest }: FieldProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, setText, inputRef);
    const edits = useEditHandlers(path, { onInput, onChange, sendEdits });
    return <input {...rest} {...edits} ref={ref} type="text" data-id={field} readOnly={!canEdit || readOnly} />;
}

export function NumberField({ field, inputRef, readOnly, onInput, onChange, sendEdits, ...rest }: FieldProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, setNumber, inputRef);
    const edits = useEditHandlers(path, { onInput, onChange, sendEdits });
    return <input {...rest} {...edits} ref={ref} type="number" data-id={field} readOnly={!canEdit || readOnly} />;
}

export function Checkbox({ field, inputRef, disabled, onInput, onChange, sendEdits, ...rest }: FieldProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding<HTMLInputElement>(sig, (el, v) => {
        if (el.checked !== !!v) el.checked = !!v;
    }, inputRef);
    const edits = useEditHandlers(path, { onInput, onChange, sendEdits });
    return <input {...rest} {...edits} ref={ref} type="checkbox" data-id={field} disabled={!canEdit || disabled} />;
}

type ReadonlyFieldProps = Omit<FieldProps, "inputRef" | keyof EditProps<HTMLInputElement>> & { type?: string };

/**
 * A computed value: readonly, out of the tab order and never focused. This is
 * not the read-only mode: it looks the same to every player.
 */
export function ReadonlyField({ field, class: cls, type = "text", ...rest }: ReadonlyFieldProps) {
    const { sig } = useFieldSignal(field);
    const ref = useBinding(sig, setText);
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

export interface TextAreaProps extends TextAreaAttrs, EditProps<HTMLTextAreaElement> {
    field: string;
    textareaRef?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ field, textareaRef, readOnly, onInput, onChange, sendEdits, ...rest }: TextAreaProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, setText, textareaRef);
    const edits = useEditHandlers(path, { onInput, onChange, sendEdits });
    return <textarea {...rest} {...edits} ref={ref} data-id={field} readOnly={!canEdit || readOnly} />;
}

type SelectAttrs = Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "ref" | "value" | "onInput" | "onChange">;

export interface SelectProps extends SelectAttrs, EditProps<HTMLSelectElement> {
    field: string;
    /** The options; `children` instead when they need optgroups. */
    options?: readonly Option[];
}

export function Select({ field, options = [], disabled, children, onInput, onChange, sendEdits, ...rest }: SelectProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, setText);
    const edits = useEditHandlers(path, { onInput, onChange, sendEdits });
    return (
        <select {...rest} {...edits} ref={ref} data-id={field} disabled={!canEdit || disabled}>
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
    const edits = useEditHandlers<HTMLInputElement>(path, {});

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
                        {...edits}
                        ref={el => { radios.current[i] = el; }}
                        type="radio"
                        class={cls}
                        data-id={field}
                        name={path}
                        value={optionValue(o)}
                        disabled={!canEdit}
                    />
                );
                return <Fragment key={optionValue(o)}>{renderOption(radio, optionValue(o), optionLabel(o))}</Fragment>;
            })}
        </>
    );
}
