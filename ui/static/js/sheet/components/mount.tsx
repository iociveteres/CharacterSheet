// The only way to put a Preact block into the sheet. The block replaces the
// contents of its mount point and is unmounted before the sheet is replaced.
import { render, type VNode } from "preact";
import { onSheetTeardown } from "../lifecycle";
import { getDataPath } from "../utils.js";
import { PathContext, SheetContext, type SheetEnv } from "./context";

let env: SheetEnv | null = null;
const roots = new Set<Element>();

/** Sets what blocks of the current sheet get through the context. */
export function setBlockEnv(next: SheetEnv): void {
    env = next;
}

/**
 * Renders `block` into `container`. The state keys the block renders must be
 * listed in PREACT_BLOCK_PATHS (state/migrated.ts), so that remote changes
 * under them only change the state.
 */
export function mountBlock(container: Element, block: VNode): void {
    if (!env) throw new Error("mountBlock: setBlockEnv was not called for this sheet");
    container.replaceChildren();
    // A mount point inside elements with data-ids continues their path.
    const basePath = getDataPath(container);
    render(
        <SheetContext.Provider value={env}>
            <PathContext.Provider value={basePath}>{block}</PathContext.Provider>
        </SheetContext.Provider>,
        container,
    );
    roots.add(container);
    onSheetTeardown(() => {
        render(null, container);
        roots.delete(container);
    });
}

/** Whether `node` belongs to a Preact block. Old code must leave such nodes alone. */
export function isInMountedBlock(node: Node): boolean {
    for (const root of roots) {
        if (root.contains(node)) return true;
    }
    return false;
}
