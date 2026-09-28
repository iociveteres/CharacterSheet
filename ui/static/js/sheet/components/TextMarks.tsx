// Marks parts of a text field's text, e.g. the words that name nothing. An
// <input> can't style part of its value, so the marks are drawn in a layer
// over the field in the field's font: the text of the layer is transparent,
// the field's own text and caret show through, and clicks pass to the field.
import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export interface TextPart {
    text: string;
    marked: boolean;
}

// What places the text in the field; copied so the layer's text lines up with it.
const COPIED = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "wordSpacing", "textIndent",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
] as const;

/**
 * The parts of the text of `inputRef`'s field, the marked ones highlighted.
 * Render it next to the field: the layer shares the field's offsetParent.
 */
export function TextMarks({ inputRef, parts }: { inputRef: RefObject<HTMLInputElement>; parts: readonly TextPart[] }) {
    const ref = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLSpanElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        const input = inputRef.current;
        if (!el || !input) return;
        const place = () => {
            const style = getComputedStyle(input);
            for (const prop of COPIED) el.style[prop] = style[prop];
            el.style.top = `${input.offsetTop}px`;
            el.style.left = `${input.offsetLeft}px`;
            el.style.width = `${input.offsetWidth}px`;
            el.style.height = `${input.offsetHeight}px`;
        };
        // A text longer than the field scrolls in it; the marks follow.
        const scroll = () => {
            if (textRef.current) textRef.current.style.transform = `translateX(${-input.scrollLeft}px)`;
        };
        const update = () => requestAnimationFrame(scroll);
        place();
        scroll();
        const observer = new ResizeObserver(place);
        observer.observe(input);
        // blur: Chrome scrolls the text back to its start without a scroll event.
        const events = ["scroll", "input", "keyup", "pointerup", "select", "blur"] as const;
        for (const type of events) input.addEventListener(type, update);
        return () => {
            observer.disconnect();
            for (const type of events) input.removeEventListener(type, update);
        };
    }, []);

    return (
        <div ref={ref} class="text-marks" aria-hidden="true">
            <span ref={textRef}>{parts.map((p, i) => (p.marked ? <mark key={i}>{p.text}</mark> : p.text))}</span>
        </div>
    );
}
