import type { ComponentChildren, RefObject } from "preact";
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
 * Calls `close` on a click outside the element of `ref` while `open`, as the
 * old Dropdown class did. `shouldClose` decides for clicks outside, e.g. to
 * keep one of several dropdowns of a block open while another one is clicked.
 */
export function useDismiss(
    ref: RefObject<Element>,
    open: boolean,
    close: () => void,
    shouldClose?: (e: MouseEvent) => boolean,
): void {
    const latest = useRef({ close, shouldClose });
    latest.current = { close, shouldClose };

    useEffect(() => {
        const el = ref.current;
        if (!el || !open) return;
        const root = el.getRootNode() as Document | ShadowRoot;
        const onClick = (e: Event) => {
            const path = e.composedPath();
            if (path.includes(el)) return;
            if (path.some(n => n instanceof Element && n.matches(CONTROL_BUTTONS))) return;
            if (latest.current.shouldClose && !latest.current.shouldClose(e as MouseEvent)) return;
            latest.current.close();
        };
        root.addEventListener("click", onClick);
        return () => root.removeEventListener("click", onClick);
    }, [open]);
}

/**
 * A toggle button and a dropdown that closes on a click outside, as the old
 * Dropdown class: the dropdown gets "visible" and the toggle "active".
 */
export function Dropdown({ class: cls, toggleClass, dropdownClass, toggle, open, shouldCloseOnOutsideClick, children }: DropdownProps) {
    const own = useSignal(false);
    const isOpen = open ?? own;
    const ref = useRef<HTMLDivElement>(null);
    useDismiss(ref, isOpen.value, () => { isOpen.value = false; }, shouldCloseOnOutsideClick);

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
