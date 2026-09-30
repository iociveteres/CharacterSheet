// A grid is frozen while an item of it is dragged: Sortable moves the DOM
// nodes then, and a Preact render of the same columns would fight it.
// Remote changes that touch the grid wait until the drop. Each sheet has its
// own frozen grids.

import { signal } from "@preact/signals-core";

type Op = () => void;

const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

export class DragFreeze {
    private frozen = new Map<string, Op[]>();
    // Bumped on every freeze and thaw, so that components rendering frozen paths re-render.
    private version = signal(0);

    freeze(gridPath: string): void {
        if (this.frozen.has(gridPath)) return;
        this.frozen.set(gridPath, []);
        this.version.value++;
    }

    /** Unfreezes the grid and returns the changes that waited, oldest first. */
    thaw(gridPath: string): Op[] {
        const queue = this.frozen.get(gridPath) ?? [];
        if (this.frozen.delete(gridPath)) this.version.value++;
        return queue;
    }

    isFrozen(gridPath: string): boolean {
        return this.frozen.has(gridPath);
    }

    /**
     * Whether a grid or tabs at `path` must not re-render their children: a drag
     * is going on in them, in a grid inside them or around them. Read during
     * render, it re-renders the component when a drag starts or ends.
     */
    isRenderFrozen(path: string): boolean {
        this.version.value;
        for (const grid of this.frozen.keys()) {
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
    runOrQueue(paths: readonly string[], op: Op): void {
        for (const [grid, queue] of this.frozen) {
            if (paths.some(p => overlaps(p, grid))) {
                queue.push(op);
                return;
            }
        }
        op();
    }

    /** Drops frozen grids of a sheet that is gone. */
    reset(): void {
        this.frozen.clear();
        this.version.value++;
    }
}

// The frozen grids of the one sheet the page shows, until sheets live side
// by side (_prd/gm_mode/sheet-instance-prd.md).
const defaultFreeze = new DragFreeze();

export const freezeGrid = (gridPath: string) => defaultFreeze.freeze(gridPath);
export const thawGrid = (gridPath: string) => defaultFreeze.thaw(gridPath);
export const isFrozen = (gridPath: string) => defaultFreeze.isFrozen(gridPath);
export const isRenderFrozen = (path: string) => defaultFreeze.isRenderFrozen(path);
export const runOrQueue = (paths: readonly string[], op: Op) => defaultFreeze.runOrQueue(paths, op);
export const resetDragFreeze = () => defaultFreeze.reset();
