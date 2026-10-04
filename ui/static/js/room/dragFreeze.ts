// While the player drags a folder, a sheet or a card of the encounter window,
// Sortable moves DOM nodes that Preact owns, and a render of the list would
// fight it. Remote changes to the list wait until the drop
// (components/useListSortable.ts), as in the sheet (sheet/state/dragFreeze.ts).

type Op = () => void;

let queue: Op[] | null = null;

export function freezeList(): void {
    queue ??= [];
}

/** Unfreezes the list and returns the changes that waited, oldest first. */
export function thawList(): Op[] {
    const ops = queue ?? [];
    queue = null;
    return ops;
}

export function runOrQueue(op: Op): void {
    if (queue) queue.push(op);
    else op();
}
