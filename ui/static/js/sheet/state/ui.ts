// UI state of the sheet that is not sheet content: whether an item is
// collapsed, which tab is open. It is keyed by state path, so it survives a
// component remount, e.g. when an item moves to another column. Toggle Descs,
// a remote batch and Enter in a field change it from outside the item.
import { batch, signal, type Signal } from "@preact/signals-core";

export interface Collapsible {
    collapsed: Signal<boolean>;
    /** Whether the collapsible part shows anything; Toggle Descs skips empty items. */
    hasContent: () => boolean;
    /** A remote batch expands the item unless this is false. */
    autoExpand: boolean;
    /** The item's root element, set once it is mounted. */
    el: Element | null;
}

const collapsedByPath = new Map<string, Signal<boolean>>();
const mounted = new Map<string, Collapsible>();
const selectedTabs = new Map<string, Signal<string | null>>();

/** The collapsed state of the item at `path`, created from `initial` on first use. */
export function collapsedSignal(path: string, initial: () => boolean): Signal<boolean> {
    let s = collapsedByPath.get(path);
    if (!s) {
        s = signal(initial());
        collapsedByPath.set(path, s);
    }
    return s;
}

/** Registers a mounted collapsible item. Returns the unregister function. */
export function registerCollapsible(path: string, entry: Collapsible): () => void {
    mounted.set(path, entry);
    return () => {
        if (mounted.get(path) === entry) mounted.delete(path);
    };
}

/** The mounted collapsible item that contains `el`. */
export function collapsibleContaining(el: Element): Collapsible | undefined {
    let found: Collapsible | undefined;
    for (const entry of mounted.values()) {
        // The innermost one: a condition entry is inside its condition.
        if (entry.el?.contains(el) && (!found || found.el!.contains(entry.el))) found = entry;
    }
    return found;
}

/**
 * Toggle Descs on the items in `panel`: if an item with content is collapsed,
 * all items with content expand; otherwise every item collapses.
 */
export function toggleDescriptions(panel: Element): void {
    const items = Array.from(mounted.values()).filter(item => item.el && panel.contains(item.el));
    const withContent = items.filter(item => item.hasContent());
    const expand = withContent.some(item => item.collapsed.value);
    batch(() => {
        for (const item of expand ? withContent : items) item.collapsed.value = !expand;
    });
}

/** What a remote batch does to the item at `path`: shows its content. */
export function expandItem(path: string): void {
    const entry = mounted.get(path);
    if (entry?.autoExpand) entry.collapsed.value = false;
}

/** The open tab of the tabs at `path`; null means the first one. */
export function selectedTabSignal(path: string): Signal<string | null> {
    let s = selectedTabs.get(path);
    if (!s) {
        s = signal(null);
        selectedTabs.set(path, s);
    }
    return s;
}

/** Forgets the UI state of a sheet that is gone. */
export function resetUiState(): void {
    collapsedByPath.clear();
    mounted.clear();
    selectedTabs.clear();
}
