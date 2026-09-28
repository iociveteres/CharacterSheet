// A list of options under a text field: the results of an autocomplete, or the
// suggestions of a SuggestField. The owner decides what is open and active.
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

interface InputDropdownProps {
    inputRef: RefObject<HTMLInputElement>;
    /** Called on a pointer down outside the list and the field. */
    onClose: () => void;
    /** The index of the active DropdownOption, -1 for none. */
    active: number;
    children: ComponentChildren;
}

/**
 * The open list under the field of `inputRef`. Render it inside an
 * .autocomplete-anchor next to the field: the list shares the field's
 * offsetParent and is placed by the field's offsets.
 */
export function InputDropdown({ inputRef, onClose, active, children }: InputDropdownProps) {
    const ref = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useLayoutEffect(() => {
        const el = ref.current;
        const input = inputRef.current;
        if (!el || !input) return;
        const place = () => {
            el.style.top = `${input.offsetTop + input.offsetHeight}px`;
            el.style.left = `${input.offsetLeft}px`;
            el.style.width = `${input.offsetWidth}px`;
        };
        place();
        const observer = new ResizeObserver(place);
        observer.observe(input);
        return () => observer.disconnect();
    }, []);

    // Clicks outside the sheet close it too, so it listens on the document.
    useEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        const onPointerDown = (e: PointerEvent) => {
            const path = e.composedPath();
            if (!path.includes(ref.current!) && !path.includes(input)) closeRef.current();
        };
        document.addEventListener("pointerdown", onPointerDown, { capture: true });
        return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    }, []);

    useLayoutEffect(() => {
        if (active >= 0) ref.current?.querySelectorAll(".autocomplete-option")[active]?.scrollIntoView({ block: "nearest" });
    }, [active]);

    return <div ref={ref} class="autocomplete-dropdown">{children}</div>;
}

/** An option of an InputDropdown. */
export function DropdownOption({ active, onPick, children }: { active: boolean; onPick: () => void; children: ComponentChildren }) {
    return (
        // mousedown, not click: the input keeps the focus.
        <div class={active ? "autocomplete-option active" : "autocomplete-option"}
            onMouseDown={e => {
                e.preventDefault();
                onPick();
            }}>
            {children}
        </div>
    );
}
