// Form fields of Preact blocks. A field shows its signal and never writes it:
// the input and change events bubble to the sheet root, where network.js
// normalizes the value, writes the signal and sends the change. The DOM
// value is set from the signal in an effect, not through a value prop, so a
// re-render never touches what the player is typing.
import { Fragment, type ComponentChildren, type JSX, type Ref, type RefObject, type VNode } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";
import { effect, Signal, type ReadonlySignal } from "@preact/signals-core";
import { resolvePath } from "../state/sync.js";
import { getDataPath } from "../utils.js";
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

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
    if (typeof ref === "function") ref(value);
    else if (ref) (ref as RefObject<T | null>).current = value;
}

/** Keeps the element in sync with the signal: `apply` runs on mount and on every change. */
function useBinding<E extends Bindable>(
    sig: ReadonlySignal<unknown> | null,
    path: string,
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
        if (!el) return;
        if (__DEV__) checkDataPath(el, path);
        if (!sig) return;
        return effect(() => apply(el, sig.value));
    }, [sig, path]);

    return setRef;
}

// network.js sends the path it reads from the data-ids of the ancestors; the
// field shows the signal at the path of its context. They must agree.
function checkDataPath(el: Element, path: string): void {
    const domPath = getDataPath(el);
    if (domPath !== path) console.warn(`Field ${path} is rendered at data-id path ${domPath}`);
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

type InputAttrs = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "ref" | "type" | "value" | "checked">;

export interface FieldProps extends InputAttrs {
    /** The data-id: the last segment of the state path. */
    field: string;
    inputRef?: Ref<HTMLInputElement>;
}

export function TextField({ field, inputRef, readOnly, ...rest }: FieldProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, path, setText, inputRef);
    return <input {...rest} ref={ref} type="text" data-id={field} readOnly={!canEdit || readOnly} />;
}

export function NumberField({ field, inputRef, readOnly, ...rest }: FieldProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, path, setNumber, inputRef);
    return <input {...rest} ref={ref} type="number" data-id={field} readOnly={!canEdit || readOnly} />;
}

export function Checkbox({ field, inputRef, disabled, ...rest }: FieldProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding<HTMLInputElement>(sig, path, (el, v) => {
        if (el.checked !== !!v) el.checked = !!v;
    }, inputRef);
    return <input {...rest} ref={ref} type="checkbox" data-id={field} disabled={!canEdit || disabled} />;
}

/**
 * A computed value: readonly, out of the tab order and never focused. This is
 * what lockUneditableInputs does for old blocks, not the read-only mode.
 */
export function ReadonlyField({ field, class: cls, type = "text", ...rest }: FieldProps & { type?: string }) {
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, path, setText);
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

type TextAreaAttrs = Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "ref" | "value">;

export interface TextAreaProps extends TextAreaAttrs {
    field: string;
    textareaRef?: Ref<HTMLTextAreaElement>;
}

export function TextArea({ field, textareaRef, readOnly, ...rest }: TextAreaProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, path, setText, textareaRef);
    return <textarea {...rest} ref={ref} data-id={field} readOnly={!canEdit || readOnly} />;
}

export type Option = string | { value: string; label: string };

const optionValue = (o: Option) => (typeof o === "string" ? o : o.value);
const optionLabel = (o: Option) => (typeof o === "string" ? o : o.label);

type SelectAttrs = Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "ref" | "value">;

export interface SelectProps extends SelectAttrs {
    field: string;
    options: readonly Option[];
}

export function Select({ field, options, disabled, ...rest }: SelectProps) {
    const { canEdit } = useSheet();
    const { path, sig } = useFieldSignal(field);
    const ref = useBinding(sig, path, setText);
    return (
        <select {...rest} ref={ref} data-id={field} disabled={!canEdit || disabled}>
            {options.map(o => <option key={optionValue(o)} value={optionValue(o)}>{optionLabel(o)}</option>)}
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

    useLayoutEffect(() => {
        if (__DEV__) radios.current.forEach(el => el && checkDataPath(el, path));
        if (!sig) return;
        return effect(() => {
            const v = text(sig.value);
            for (const el of radios.current) {
                if (el && el.checked !== (el.value === v)) el.checked = el.value === v;
            }
        });
    }, [sig, path]);

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
                    />
                );
                return <Fragment key={optionValue(o)}>{renderOption(radio, optionValue(o), optionLabel(o))}</Fragment>;
            })}
        </>
    );
}
