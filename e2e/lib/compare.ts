// Snapshots of a rendered sheet for comparing the build under test with the
// old one (config.oldBase) on the same database.
import type { Player } from "./player";

/** [path, value] of every field with a data-id in document order; a radio group once, with its checked value. */
export type Values = [string, unknown][];

export async function valueSnapshot(p: Player): Promise<Values> {
    return p.page.evaluate(() => {
        const out: [string, unknown][] = [];
        const radios = new Set<string>();
        const fields = window.__e2e.root().querySelectorAll<HTMLInputElement>("input[data-id], select[data-id], textarea[data-id]");
        for (const el of Array.from(fields)) {
            const path = window.__e2e.pathOf(el);
            if (el.type === "radio") {
                if (radios.has(path)) continue;
                radios.add(path);
                out.push([path, window.__e2e.read(path)]);
            } else {
                out.push([path, el.type === "checkbox" ? el.checked : el.value]);
            }
        }
        return out;
    });
}

/** Groups the snapshot by the first segment of the path, keeping the order. */
export function byGroup(values: Values): Map<string, Values> {
    const out = new Map<string, Values>();
    for (const entry of values) {
        const group = entry[0].split(".")[0];
        if (!out.has(group)) out.set(group, []);
        out.get(group)!.push(entry);
    }
    return out;
}

/** Whether `sub` is `all` with some entries left out. */
export function isSubsequence(sub: Values, all: Values): boolean {
    let i = 0;
    for (const [path, value] of all) {
        if (i < sub.length && sub[i][0] === path && sub[i][1] === value) i++;
    }
    return i === sub.length;
}

export interface Box {
    /** What the element is: a field by its path, anything else by tag, path and text. */
    key: string;
    x: number;
    y: number;
    w: number;
    h: number;
    /** An empty label.chk-label with no checkbox inside. */
    emptyCheckLabel: boolean;
}

/**
 * Page coordinates of the visible fields, labels, headings and buttons. A
 * label with a field inside is keyed by the field, so the option texts of a
 * select in it do not matter; other texts are compared without whitespace.
 */
export async function boxSnapshot(p: Player): Promise<Box[]> {
    return p.page.evaluate(() => {
        const { root, pathOf } = window.__e2e;
        const FIELD = "input[data-id], select[data-id], textarea[data-id]";
        const squash = (s: string | null) => (s ?? "").replace(/\s+/g, "");
        const fieldKey = (f: HTMLInputElement) => pathOf(f) + (f.type === "radio" ? `=${f.value}` : "");
        const counts = new Map<string, number>();
        const out: Box[] = [];
        for (const el of Array.from(root().querySelectorAll<HTMLElement>(`${FIELD}, label, h2, h3, button`))) {
            const r = el.getBoundingClientRect();
            // Collapsed content is visibility: hidden and keeps its boxes.
            if (r.width === 0 || r.height === 0 || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
            const tag = el.tagName.toLowerCase();
            let base: string;
            let emptyCheckLabel = false;
            if (el.matches(FIELD)) {
                base = `field:${fieldKey(el as HTMLInputElement)}`;
            } else if (tag === "label" && el.querySelector(FIELD)) {
                base = `label>${fieldKey(el.querySelector(FIELD)!)}`;
            } else {
                base = `${tag}@${pathOf(el)}:${squash(el.textContent)}`;
                emptyCheckLabel = tag === "label" && el.classList.contains("chk-label") && !squash(el.textContent);
            }
            const n = (counts.get(base) ?? 0) + 1;
            counts.set(base, n);
            out.push({
                key: `${base}#${n}`,
                x: Math.round(r.left + window.scrollX),
                y: Math.round(r.top + window.scrollY),
                w: Math.round(r.width),
                h: Math.round(r.height),
                emptyCheckLabel,
            });
        }
        return out;
    });
}
