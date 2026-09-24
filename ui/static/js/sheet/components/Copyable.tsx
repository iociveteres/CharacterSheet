import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** Copies its text on click and flashes the "copied" mark. Replaces initCopyable. */
export function Copyable({ children }: { children?: ComponentChildren }) {
    const ref = useRef<HTMLDivElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(timer.current), []);

    const onClick = async () => {
        const el = ref.current;
        if (!el) return;
        await navigator.clipboard.writeText(el.textContent ?? "");
        // Restarting a CSS animation needs the class off for one reflow.
        // Preact leaves the class alone: the class prop never changes.
        el.classList.remove("copied");
        void el.offsetWidth;
        el.classList.add("copied");
        clearTimeout(timer.current);
        timer.current = setTimeout(() => el.classList.remove("copied"), 800);
    };

    return <div ref={ref} class="copyable" onClick={onClick}>{children}</div>;
}
