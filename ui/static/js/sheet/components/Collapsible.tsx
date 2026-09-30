import { useLayoutEffect, useRef } from "preact/hooks";
import { useSheet } from "./context";

export interface CollapsibleOptions {
    /** Whether the collapsible part shows anything. Read when the item mounts and by Toggle Descs. */
    hasContent: () => boolean;
    /** A remote batch expands the item unless this is false. */
    autoExpand?: boolean;
    /** Whether the item starts collapsed; when it has no content by default. */
    startsCollapsed?: () => boolean;
}

/**
 * The collapsed state of the item at `path`. It lives in a UI signal, so
 * Toggle Descs, a remote batch and Enter in the name field change it without
 * touching the item's classes. An item without content starts collapsed, as
 * setInitialCollapsedState does for old items. Pass `elRef` to the item's
 * root element.
 */
export function useCollapsible(path: string, { hasContent, autoExpand = true, startsCollapsed }: CollapsibleOptions) {
    const content = useRef(hasContent);
    content.current = hasContent;
    const elRef = useRef<HTMLElement | null>(null);
    const { ui } = useSheet();
    const collapsed = ui.collapsedSignal(path, startsCollapsed ?? (() => !hasContent()));

    useLayoutEffect(() => ui.registerCollapsible(path, {
        collapsed,
        hasContent: () => content.current(),
        autoExpand,
        get el() { return elRef.current; },
    }), [ui, path, collapsed, autoExpand]);

    return {
        collapsed: collapsed.value,
        toggle: () => { collapsed.value = !collapsed.value; },
        elRef,
    };
}

export function ToggleButton({ onToggle }: { onToggle: () => void }) {
    return <button class="toggle-button" onClick={onToggle} />;
}
