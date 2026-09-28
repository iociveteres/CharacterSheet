// The root of a sheet: the sheet context, the controls (Delete Mode, Toggle
// Descs and the buttons of the sheet's kind) and the layout of the kind.
import { render, type ComponentType } from "preact";
import { useRef } from "preact/hooks";
import { SheetContext, type SheetEnv } from "./components/context";
import { onSheetTeardown } from "./lifecycle";
import { collapsibleContaining, toggleDescriptions } from "./state/ui";
import { online } from "./connection";

// Items whose inputs Enter walks through.
const ENTER_ITEMS = ".item-with-description, .custom-skill, .ranged-attack, .melee-attack, .experience-item, .psychic-power, .tech-power, .gear-item";

/** Enter in an input of an item moves the focus to the item's next field. */
function focusNextField(e: KeyboardEvent): void {
    const field = e.target;
    if (e.key !== "Enter" || e.shiftKey || !(field instanceof HTMLInputElement)) return;
    const item = field.closest(ENTER_ITEMS);
    if (!item) return;
    e.preventDefault();

    const fields = Array.from(item.querySelectorAll<HTMLElement>("input:not([readonly]):not([disabled]), textarea"));
    const next = fields[fields.indexOf(field) + 1];
    if (!next) return;

    // A collapsed item hides its description: expand it and focus once it has rendered.
    const collapsible = collapsibleContaining(next);
    if (!collapsible) {
        next.focus();
        return;
    }
    if (next.classList.contains("split-description")) collapsible.collapsed.value = false;
    setTimeout(() => next.focus(), 0);
}

export interface SheetProps {
    env: SheetEnv;
    Layout: ComponentType;
    Controls?: ComponentType;
}

export function Sheet({ env, Layout, Controls }: SheetProps) {
    const container = useRef<HTMLDivElement>(null);

    // Only CSS reads the class, so the sheet does not re-render for it.
    const toggleDeletionMode = () => container.current?.classList.toggle("deletion-mode");

    const toggleAll = () => {
        // An open dropdown of the controls covers the tab, so it takes the toggle.
        const panel = container.current?.querySelector('.controls-dropdown')
            ?? container.current?.querySelector('.radiotab[name="toggle"]:checked + .tablabel + .panel');
        if (panel) toggleDescriptions(panel);
    };

    return (
        <SheetContext.Provider value={env}>
            <div ref={container} class="container" onKeyDown={focusNextField}>
                <div class="wrapper">
                    <div class="controls-block">
                        {env.canEdit && online.value && (
                            <button class="toggle-delete-mode" id="toggle-delete-mode" title="Enable/disable deleting items"
                                onClick={toggleDeletionMode}>
                                Delete Mode
                            </button>
                        )}
                        <button class="toggle-descriptions" id="toggle-descriptions" title="Show/hide all descriptions" onClick={toggleAll}>
                            Toggle Descs
                        </button>
                        {Controls && <Controls />}
                    </div>
                    <Layout />
                </div>
            </div>
        </SheetContext.Provider>
    );
}

/** Renders the sheet into `root`. It is unmounted with the sheet (lifecycle.ts). */
export function mountSheet(root: Element | ShadowRoot, env: SheetEnv, Layout: ComponentType, Controls?: ComponentType): void {
    render(<Sheet env={env} Layout={Layout} Controls={Controls} />, root);
    onSheetTeardown(() => render(null, root));
}
