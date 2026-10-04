// Pieces the panels and dialogs of the bestiary share: the ⋯ menu, the
// rename in place and the modal frame.
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useClickOutside } from "../../room/components/useClickOutside";

/** A faint ⋯ button with a dropdown; a click on an item closes it. */
export function Menu({ label, class: className, children }: { label: string; class: string; children: ComponentChildren }) {
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    useClickOutside(box, open, () => setOpen(false));
    return (
        <div class={`bestiary-menu-box ${className}`} ref={box}>
            <button type="button" class="button-linklike bestiary-menu-btn" title={label} aria-label={label} aria-expanded={open}
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

/**
 * A name renamed in place: a faint ✎ after it, `children`, turns it into a
 * field; Enter or leaving the field saves a new name, Esc keeps the old one.
 */
export function InlineName({ name, what, maxLength, save, children }: {
    name: string;
    what: string;
    maxLength: number;
    save: (name: string) => void;
    children: ComponentChildren;
}) {
    const [editing, setEditing] = useState(false);
    const field = useRef<HTMLInputElement>(null);
    // Chrome blurs a focused field as it is taken out: Esc must not save.
    const cancelled = useRef(false);
    useEffect(() => {
        cancelled.current = false;
        if (editing) field.current?.select();
    }, [editing]);
    if (!editing) {
        return <>
            {children}
            <button type="button" class="button-linklike bestiary-rename" title="Rename" aria-label={`Rename the ${what}`}
                onClick={() => setEditing(true)}>✎</button>
        </>;
    }
    const done = (value: string) => {
        setEditing(false);
        const trimmed = value.trim();
        if (!cancelled.current && trimmed && trimmed !== name) save(trimmed);
    };
    return (
        <input type="text" class="bestiary-name-input" aria-label={`Name of the ${what}`} maxLength={maxLength}
            defaultValue={name} ref={field}
            onBlur={e => done(e.currentTarget.value)}
            onKeyDown={e => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                    cancelled.current = true;
                    setEditing(false);
                }
            }} />
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
