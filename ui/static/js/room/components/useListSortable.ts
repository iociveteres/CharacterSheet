// Dragging folders and sheets of the Characters tab and the cards of the
// encounter window with Sortable, by the scheme of the sheet
// (sheet/components/useSortable.ts). Sortable moves DOM nodes that Preact owns,
// so remote changes to the list wait for the drop (dragFreeze.ts). On drop the
// node goes back where it was, the waiting changes apply, and `onDrop` puts the
// new place into the state; Preact then moves the node itself.
import type { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { batch } from "@preact/signals";
import Sortable from "sortablejs";
import { freezeList, thawList } from "../dragFreeze";

export interface Drop {
    item: HTMLElement;
    from: HTMLElement;
    to: HTMLElement;
    /** The draggable children of `to` in the order the player left them. */
    order: HTMLElement[];
}

export interface ListSortableOptions {
    /** Lists of one group trade items. */
    group?: string;
    /** Where an item is taken; anywhere on it but `filter` without one. */
    handle?: string;
    filter?: string;
    draggable: string;
    onDrop: (drop: Drop) => void;
}

/** Makes the children of `ref` sortable for as long as the component lives. */
export function useListSortable(ref: RefObject<HTMLElement>, { group, handle, filter, draggable, onDrop }: ListSortableOptions): void {
    const drop = useRef(onDrop);
    drop.current = onDrop;

    useLayoutEffect(() => {
        let origin: { item: HTMLElement; parent: Node; next: Node | null } | null = null;

        const sortable = Sortable.create(ref.current!, {
            group,
            handle,
            filter,
            // A click on a filtered button or field still does its job.
            preventOnFilter: false,
            draggable,
            animation: 150,
            ghostClass: "sortable-ghost",
            chosenClass: "sortable-chosen",
            dragClass: "sortable-drag",
            onStart: evt => {
                origin = { item: evt.item, parent: evt.item.parentNode!, next: evt.item.nextSibling };
                freezeList();
            },
            onEnd: evt => {
                if (!origin) return;
                const order = Array.from(evt.to.children).filter((el): el is HTMLElement => el.matches(draggable));
                const dropped: Drop = { item: evt.item, from: evt.from, to: evt.to, order };
                origin.parent.insertBefore(origin.item, origin.next);
                origin = null;
                // The list renders once, with the drop and what changed meanwhile.
                batch(() => {
                    for (const op of thawList()) op();
                    drop.current(dropped);
                });
            },
        });

        return () => {
            sortable.destroy();
            // Unmounted mid-drag, the list lets the waiting changes through.
            if (origin) batch(() => thawList().forEach(op => op()));
        };
    }, []);
}
