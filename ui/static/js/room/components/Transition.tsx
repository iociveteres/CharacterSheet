// Shows and hides one element with the enter and leave classes of room.css, as
// Alpine's x-transition did.
import { cloneElement, type VNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

/** The longest transition of `el` with its delay, as the browser computed it. */
function transitionMs(el: HTMLElement): number {
    const style = getComputedStyle(el);
    const seconds = (list: string) => list.split(",").map(v => parseFloat(v) || 0);
    const durations = seconds(style.transitionDuration);
    const delays = seconds(style.transitionDelay);
    return Math.max(0, ...durations.map((d, i) => d + (delays[i] ?? delays[0] ?? 0))) * 1000;
}

/**
 * Renders `children` while `show` and while it leaves. Entering, the element
 * gets `<name>-enter` and `<name>-enter-start`, then `<name>-enter-end` in
 * place of the start; the classes go when the transition ends. Leaving is the
 * same with `-leave-`. The first render shows or hides it without one.
 */
export function Transition({ show, name, children }: { show: boolean; name: string; children: VNode<any> }) {
    const [present, setPresent] = useState(show);
    const el = useRef<HTMLElement>(null);
    const first = useRef(true);

    useLayoutEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        if (show) setPresent(true);
        const node = el.current;
        if (!node) return;

        const phase = show ? "enter" : "leave";
        const [active, start, end] = [`${name}-${phase}`, `${name}-${phase}-start`, `${name}-${phase}-end`];
        node.classList.remove(`${name}-enter`, `${name}-enter-start`, `${name}-enter-end`,
            `${name}-leave`, `${name}-leave-start`, `${name}-leave-end`);
        node.classList.add(active, start);
        // Reading the layout makes the browser take the start state before the end one.
        node.getBoundingClientRect();
        node.classList.replace(start, end);

        const timer = setTimeout(() => {
            node.classList.remove(active, end);
            if (!show) setPresent(false);
        }, transitionMs(node));
        return () => clearTimeout(timer);
    }, [show]);

    return show || present ? cloneElement(children, { ref: el }) : null;
}
