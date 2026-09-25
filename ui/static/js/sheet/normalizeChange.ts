// The value a sheet control sends when the player edits it. The fields call
// it for their input and change events (components/fields.tsx).

/** The event that reports the edit. */
export type ChangeEventKind = "input" | "change";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function parseMaybeNumber(s: string): string | number | null {
    if (s === "") return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    return s;
}

function inputValue(el: Control): unknown {
    if (el instanceof HTMLInputElement) {
        switch (el.type) {
            case "number": return parseMaybeNumber(el.value);
            case "checkbox": return el.checked;
            // Only the checked radio button of a group sends its value.
            case "radio": return el.checked ? parseMaybeNumber(el.value) : undefined;
            default: return el.value;
        }
    }
    if (el instanceof HTMLSelectElement) {
        if (el.multiple) return Array.from(el.selectedOptions, opt => parseMaybeNumber(opt.value));
        return parseMaybeNumber(el.value);
    }
    return el.value;
}

function changeValue(el: Control): unknown {
    // Text is sent on input only.
    if (el instanceof HTMLTextAreaElement) return undefined;
    if (el instanceof HTMLInputElement && (el.type === "text" || el.classList.contains("textlike"))) return undefined;
    if (!el.value) return undefined;
    if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
    if ((el instanceof HTMLInputElement && el.type === "number") || el.dataset.type === "number" || el.dataset.id === "size") {
        return Number(el.value);
    }
    return el.value;
}

/**
 * The value an edit of `el` sends, or undefined when the event sends nothing.
 *
 * A select, radio button or checkbox fires both events. The change event
 * comes last, and as both are debounced by path, its value is the one that is
 * sent: a string for a select or radio button unless it is marked
 * data-type="number".
 */
export function normalizeChange(el: Element, kind: ChangeEventKind): unknown {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        return undefined;
    }
    return kind === "input" ? inputValue(el) : changeValue(el);
}
