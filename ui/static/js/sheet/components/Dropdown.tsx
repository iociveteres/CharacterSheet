import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals-core";

export interface DropdownProps {
    /** Class of the element that holds the toggle and the dropdown. */
    class?: string;
    toggleClass?: string;
    dropdownClass?: string;
    /** Content of the toggle button. */
    toggle: (open: boolean) => ComponentChildren;
    /** Open state from outside, e.g. to open it when a value is clicked. */
    open?: Signal<boolean>;
    /** For a click outside the dropdown: return false to keep it open. */
    shouldCloseOnOutsideClick?: (e: MouseEvent) => boolean;
    children?: ComponentChildren;
}

// The sheet's control buttons work on the open dropdown and must not close it.
const CONTROL_BUTTONS = "#toggle-delete-mode, #toggle-descriptions";

/**
 * A toggle button and a dropdown that closes on a click outside, as the old
 * Dropdown class: the dropdown gets "visible" and the toggle "active".
 */
export function Dropdown({ class: cls, toggleClass, dropdownClass, toggle, open, shouldCloseOnOutsideClick, children }: DropdownProps) {
    const own = useSignal(false);
    const isOpen = open ?? own;
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el || !isOpen.value) return;
        const root = el.getRootNode() as Document | ShadowRoot;
        const onClick = (e: Event) => {
            const path = e.composedPath();
            if (path.includes(el)) return;
            if (path.some(n => n instanceof Element && n.matches(CONTROL_BUTTONS))) return;
            if (shouldCloseOnOutsideClick && !shouldCloseOnOutsideClick(e as MouseEvent)) return;
            isOpen.value = false;
        };
        root.addEventListener("click", onClick);
        return () => root.removeEventListener("click", onClick);
    }, [isOpen.value]);

    const joined = (base: string | undefined, extra: string) => (base ? `${base} ${extra}` : extra).trim();

    return (
        <div ref={ref} class={cls}>
            <button
                type="button"
                class={joined(toggleClass, isOpen.value ? "active" : "")}
                onClick={() => { isOpen.value = !isOpen.value; }}
            >
                {toggle(isOpen.value)}
            </button>
            <div class={joined(dropdownClass, isOpen.value ? "visible" : "")}>{children}</div>
        </div>
    );
}
