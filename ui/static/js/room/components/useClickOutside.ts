import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

/**
 * Calls `onOutside` on a click outside `ref` while `active`. `ref` holds the
 * popover with the button that opens it, so that button only toggles it.
 */
export function useClickOutside(ref: RefObject<HTMLElement>, active: boolean, onOutside: () => void): void {
    useEffect(() => {
        if (!active) return;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
        };
        document.addEventListener("click", onClick);
        return () => document.removeEventListener("click", onClick);
    }, [active]);
}
