// UI state of a sheet that is not sheet content: whether an item is
// collapsed, which tab is open. It is keyed by state path, so it survives a
// component remount, e.g. when an item moves to another column. Toggle Descs,
// a remote batch and Enter in a field change it from outside the item. Each
// sheet has its own: an item collapsed in one sheet stays open in another.
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

export class SheetUiState {
    private collapsedByPath = new Map<string, Signal<boolean>>();
    // A set per path: the same item can be mounted twice, e.g. Conditions on two tabs.
    private mounted = new Map<string, Set<Collapsible>>();
    private selectedTabs = new Map<string, Signal<string | null>>();

    /** The collapsed state of the item at `path`, created from `initial` on first use. */
    collapsedSignal(path: string, initial: () => boolean): Signal<boolean> {
        let s = this.collapsedByPath.get(path);
        if (!s) {
            s = signal(initial());
            this.collapsedByPath.set(path, s);
        }
        return s;
    }

    /** Registers a mounted collapsible item. Returns the unregister function. */
    registerCollapsible(path: string, entry: Collapsible): () => void {
        let entries = this.mounted.get(path);
        if (!entries) {
            entries = new Set();
            this.mounted.set(path, entries);
        }
        entries.add(entry);
        return () => {
            entries.delete(entry);
            if (entries.size === 0 && this.mounted.get(path) === entries) this.mounted.delete(path);
        };
    }

    private allMounted(): Collapsible[] {
        return Array.from(this.mounted.values(), entries => Array.from(entries)).flat();
    }

    /** The mounted collapsible item that contains `el`. */
    collapsibleContaining(el: Element): Collapsible | undefined {
        let found: Collapsible | undefined;
        for (const entry of this.allMounted()) {
            // The innermost one: a condition entry is inside its condition.
            if (entry.el?.contains(el) && (!found || found.el!.contains(entry.el))) found = entry;
        }
        return found;
    }

    /**
     * Toggle Descs on the items in `panel`: if an item with content is collapsed,
     * all items with content expand; otherwise every item collapses.
     */
    toggleDescriptions(panel: Element): void {
        const items = this.allMounted().filter(item => item.el && panel.contains(item.el));
        const withContent = items.filter(item => item.hasContent());
        const expand = withContent.some(item => item.collapsed.value);
        batch(() => {
            for (const item of expand ? withContent : items) item.collapsed.value = !expand;
        });
    }

    /** What a remote batch does to the item at `path`: shows its content. */
    expandItem(path: string): void {
        for (const entry of this.mounted.get(path) ?? []) {
            if (entry.autoExpand) entry.collapsed.value = false;
        }
    }

    /** The open tab of the tabs at `path`; null means the first one. */
    selectedTabSignal(path: string): Signal<string | null> {
        let s = this.selectedTabs.get(path);
        if (!s) {
            s = signal(null);
            this.selectedTabs.set(path, s);
        }
        return s;
    }
}
