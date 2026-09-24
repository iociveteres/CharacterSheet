// Paths of the blocks that Preact renders. network.js applies remote changes
// under these paths to the state only; old blocks still get DOM events.

const prefixes = new Map<string, number>();

/** Marks the state under `paths` as rendered by Preact. Returns the undo. */
export function registerStatePaths(paths: readonly string[]): () => void {
    for (const p of paths) prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
    return () => {
        for (const p of paths) {
            const n = (prefixes.get(p) ?? 0) - 1;
            if (n > 0) prefixes.set(p, n);
            else prefixes.delete(p);
        }
    };
}

/** Whether the state at `path` belongs to a block that Preact renders. */
export function isMigratedPath(path: string): boolean {
    for (const p of prefixes.keys()) {
        if (path === p || path.startsWith(`${p}.`)) return true;
    }
    return false;
}
