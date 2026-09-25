// A grid is frozen while an item of it is dragged: Sortable moves the DOM
// nodes then, and a Preact render of the same columns would fight it.
// Remote changes that touch the grid wait until the drop.

import { signal } from "@preact/signals-core";

type Op = () => void;

const frozen = new Map<string, Op[]>();
// Bumped on every freeze and thaw, so that components rendering frozen paths re-render.
const version = signal(0);

const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

export function freezeGrid(gridPath: string): void {
    if (frozen.has(gridPath)) return;
    frozen.set(gridPath, []);
    version.value++;
}

/** Unfreezes the grid and returns the changes that waited, oldest first. */
export function thawGrid(gridPath: string): Op[] {
    const queue = frozen.get(gridPath) ?? [];
    if (frozen.delete(gridPath)) version.value++;
    return queue;
}

export function isFrozen(gridPath: string): boolean {
    return frozen.has(gridPath);
}

/**
 * Whether a grid or tabs at `path` must not re-render their children: a drag
 * is going on in them, in a grid inside them or around them. Read during
 * render, it re-renders the component when a drag starts or ends.
 */
export function isRenderFrozen(path: string): boolean {
    version.value;
    for (const grid of frozen.keys()) {
        if (overlaps(path, grid)) return true;
    }
    return false;
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
    version.value++;
}
