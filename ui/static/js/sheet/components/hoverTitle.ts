// A title built when the pointer enters the element, not on render: the
// signals it reads subscribe nothing, so what it explains changing re-renders
// no block. The browser shows a title after a delay, by then it is set.
import { untracked } from "@preact/signals-core";

/** Props that give the element the lines of `lines` as its title on hover; none leave it without one. */
export function hoverTitle(lines: () => readonly string[]): { onPointerEnter: (e: Event) => void } {
    return {
        onPointerEnter: e => {
            (e.currentTarget as HTMLElement).title = untracked(lines).join("\n");
        },
    };
}
