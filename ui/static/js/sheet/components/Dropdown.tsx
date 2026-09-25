import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";

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
 * The open state of a dropdown in the element of `ref`: it closes on a click
 * outside that element. The markup is the block's own; the dropdown gets
 * "visible" and its toggle "active", as with the old Dropdown class.
 */
export function useDropdown(ref: RefObject<Element>) {
    const open = useSignal(false);
    useDismiss(ref, open.value, () => { open.value = false; });
    return {
        open: open.value,
        toggle: () => { open.value = !open.value; },
        show: () => { open.value = true; },
        close: () => { open.value = false; },
    };
}
