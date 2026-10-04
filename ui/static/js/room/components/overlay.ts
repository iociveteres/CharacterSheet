import { useEffect } from "preact/hooks";
import type { JSX } from "preact";

/** A click on the overlay itself, not on the dialog on it, closes the dialog. */
export function closeOnOverlay(close: () => void) {
    return (e: JSX.TargetedMouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) close();
    };
}

/** Esc closes the dialog while it is up. */
export function useEscape(close: () => void): void {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
}
