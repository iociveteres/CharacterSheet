// A grid is frozen while an item of it is dragged: Sortable moves the DOM
// nodes then, and a Preact render of the same columns would fight it.
// Remote changes that touch the grid wait until the drop.

type Op = () => void;

const frozen = new Map<string, Op[]>();

const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

export function freezeGrid(gridPath: string): void {
    if (!frozen.has(gridPath)) frozen.set(gridPath, []);
}

/** Unfreezes the grid and returns the changes that waited, oldest first. */
export function thawGrid(gridPath: string): Op[] {
    const queue = frozen.get(gridPath) ?? [];
    frozen.delete(gridPath);
    return queue;
}

export function isFrozen(gridPath: string): boolean {
    return frozen.has(gridPath);
}

/**
 * Runs `op` now, or queues it when one of `paths` is inside a frozen grid,
 * inside an item that holds it or is the grid itself. Everything that touches
 * the grid queues, field changes too, so that a change to an item that a
 * queued createItem adds is not applied before the item exists.
 */
export function runOrQueue(paths: readonly string[], op: Op): void {
    for (const [grid, queue] of frozen) {
        if (paths.some(p => overlaps(p, grid))) {
            queue.push(op);
            return;
        }
    }
    op();
}

/** Drops frozen grids of a sheet that is gone. */
export function resetDragFreeze(): void {
    frozen.clear();
}
