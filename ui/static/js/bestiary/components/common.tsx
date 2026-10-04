// Pieces the panels and dialogs of the bestiary share: the ⋯ menu, the tag
// chips and the tag input, the modal frame.
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useClickOutside } from "../../room/components/useClickOutside";

/** A ⋯ button with a dropdown; a click on an item closes it. */
export function Menu({ label, class: className, children }: { label: string; class: string; children: ComponentChildren }) {
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    useClickOutside(box, open, () => setOpen(false));
    return (
        <div class={`bestiary-menu-box ${className}`} ref={box}>
            <button type="button" class="bestiary-menu-btn" title={label} aria-label={label} aria-expanded={open}
                onClick={() => setOpen(!open)}>⋯</button>
            {open && <div class="bestiary-menu" role="menu" onClick={() => setOpen(false)}>{children}</div>}
        </div>
    );
}

export function MenuItem({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: ComponentChildren }) {
    return (
        <button type="button" role="menuitem" class={danger ? "button-linklike bestiary-menu-item danger" : "button-linklike bestiary-menu-item"}
            onClick={onClick}>{children}</button>
    );
}

export function Tags({ tags }: { tags: string[] }) {
    if (!tags.length) return null;
    return <span class="bestiary-tags">{tags.map(t => <span key={t} class="bestiary-chip">{t}</span>)}</span>;
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Tags as chips with a field for more: Enter or a comma adds what is typed,
 * and so does leaving the field, so Save takes a tag not yet added. The
 * datalist suggests the user's tags.
 */
export function TagInput({ tags, suggestions, onChange, listId }: {
    tags: string[];
    suggestions: string[];
    onChange: (tags: string[]) => void;
    listId: string;
}) {
    const [text, setText] = useState("");
    // It opens in a dialog to be typed into.
    const field = useRef<HTMLInputElement>(null);
    useEffect(() => field.current?.focus(), []);
    const add = (typed: string) => {
        const next = [...tags];
        for (const part of typed.split(",")) {
            const tag = part.trim();
            if (tag && !next.some(t => sameTag(t, tag))) next.push(tag);
        }
        if (next.length !== tags.length) onChange(next);
        setText("");
    };
    return (
        <div class="bestiary-tag-input">
            {tags.map(t => (
                <span key={t} class="bestiary-chip">
                    {t}
                    <button type="button" class="button-linklike bestiary-chip-remove" aria-label={`Remove ${t}`}
                        onClick={() => onChange(tags.filter(x => x !== t))}>×</button>
                </span>
            ))}
            <input type="text" class="bestiary-tag-field" ref={field} list={listId} value={text} maxLength={40} placeholder="Add a tag"
                aria-label="Add a tag"
                onInput={e => {
                    const value = e.currentTarget.value;
                    if (value.includes(",")) add(value);
                    else setText(value);
                }}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        add(text);
                    } else if (e.key === "Backspace" && !text && tags.length) {
                        onChange(tags.slice(0, -1));
                    }
                }}
                onBlur={() => add(text)} />
            <datalist id={listId}>
                {suggestions.filter(s => !tags.some(t => sameTag(t, s))).map(s => <option key={s} value={s} />)}
            </datalist>
        </div>
    );
}

export function useEscape(close: () => void): void {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
}

/** The overlay with a dialog on it; a click on the overlay or Esc closes it. */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ComponentChildren }) {
    useEscape(onClose);
    return (
        <div class="overlay open" onClick={e => {
            if (e.target === e.currentTarget) onClose();
        }}>
            <div class="modal layout-column bestiary-dialog" role="dialog" aria-modal="true" aria-label={label}>
                <h3>{label}</h3>
                {children}
            </div>
        </div>
    );
}
