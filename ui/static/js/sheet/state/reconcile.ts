// Compares the state scanned from the rendered markup (domToSignals) with the
// state built from the sheet JSON (jsonToSignals). Used by the dev-mode check
// in initState and by scripts/reconcile-sheets.mjs.

import { Signal } from "@preact/signals-core";
import { specAtPath, type SignalTree } from "./fromJson";

export interface TreeDiff {
    path: string;
    /** Value in the tree scanned from the markup, undefined when absent. */
    dom: unknown;
    /** Value in the tree built from JSON, undefined when absent. */
    json: unknown;
    /** The path belongs to a ghost item: a layouts key without an item. */
    ghost: boolean;
}

function flatten(tree: SignalTree, prefix: string, out: Map<string, unknown>): Map<string, unknown> {
    for (const [key, node] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (node instanceof Signal) {
            // Layouts are not in the markup as values, the grid order shows them.
            if (key !== "layouts") out.set(path, node.peek());
        } else if (node && typeof node === "object") {
            flatten(node, path, out);
        }
    }
    return out;
}

const isComputed = (path: string) => specAtPath(path)?.kind === "computed";

/**
 * Lists every leaf whose value or type differs between the two trees.
 * Computed outputs are skipped: attachComputeds() replaces them anyway.
 * `ghosts` are item paths ("conditions.list.items.<id>") whose differences
 * are expected and only flagged.
 */
export function compareTrees(domTree: SignalTree, jsonTree: SignalTree, ghosts: readonly string[] = []): TreeDiff[] {
    const dom = flatten(domTree, "", new Map());
    const json = flatten(jsonTree, "", new Map());
    const isGhost = (path: string) => ghosts.some(g => path === g || path.startsWith(`${g}.`));

    const diffs: TreeDiff[] = [];
    for (const path of new Set([...dom.keys(), ...json.keys()])) {
        if (isComputed(path)) continue;
        const d = dom.get(path);
        const j = json.get(path);
        if (dom.has(path) && json.has(path) && d === j) continue;
        diffs.push({ path, dom: d, json: j, ghost: isGhost(path) });
    }
    return diffs.sort((a, b) => a.path.localeCompare(b.path));
}

const show = (v: unknown) => (v === undefined ? "(none)" : JSON.stringify(v));

export function formatDiff({ path, dom, json, ghost }: TreeDiff): string {
    return `${ghost ? "[ghost] " : ""}${path}: markup ${show(dom)}, json ${show(json)}`;
}
