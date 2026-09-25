// The Conditions block in the Characteristics dropdown. Its Go template is an
// empty mount point (ui/html/sheet/27_conditions.html).
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath, type AutocompleteResult } from "../components/context";
import { Copyable } from "../components/Copyable";
import { Checkbox, NumberField, TextField } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { mountBlock } from "../components/mount";
import { Scope } from "../components/Scope";
import { AutocompleteAnchor, useAutocomplete } from "../components/useAutocomplete";
import { resolvePath } from "../state/sync.js";
import { conditionFactory } from "../factories/condition";
import { ConditionEntries } from "./ConditionEntries";

// The server has no "conditions" collection yet; the old block asked for it too.
const COLLECTION = "conditions";

function conditionOption(r: AutocompleteResult): string {
    const name = r.name_ru ? `${r.name} / ${r.name_ru}` : r.name;
    return `<div class="ac-header"><span class="ac-name">${name}</span></div>`;
}

export function ConditionItem({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    // As for old items: a condition without entries has nothing to show and starts collapsed.
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => Object.keys((resolvePath(`${path}.entries.items`) as object | null) ?? {}).length > 0,
    });
    const { inputRef, anchorRef } = useAutocomplete(path, COLLECTION, conditionOption);

    return (
        <Scope dataId={itemId} class={collapsed ? "condition-item collapsed" : "condition-item"} elRef={elRef}>
            <div class="split-header">
                <Checkbox field="enabled" class="custom" />
                <TextField field="name" class="long textlike" inputRef={inputRef} />
                <AutocompleteAnchor anchorRef={anchorRef} />
                <label>
                    X:<NumberField field="stacks" class="short" min="0" title="Stack count — uses in place of X in entries" />
                </label>
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="collapsible-content">
                <ConditionEntries itemId={itemId} />
            </div>
        </Scope>
    );
}

export function Conditions() {
    return (
        <div class="conditions-section layout-column">
            <h3>Conditions</h3>
            <div class="condition-syntax-clarification">
                Use X as variable and ▲/▼ after X to round up/down (e.g. 0.5X▲+1). Click to copy:
                <Copyable>▲</Copyable>
                <Copyable>▼</Copyable>
            </div>
            <ItemGrid
                dataId="conditions.list.items"
                id="conditions"
                columns={2}
                columnClass="condition-column"
                itemClass="condition-item"
                newItem={conditionFactory}
                renderItem={id => <ConditionItem itemId={id} />}
            />
        </div>
    );
}

/** Renders Conditions into its mount point in the sheet. */
export function mountConditions(root: ParentNode): void {
    const mount = root.querySelector('[data-block="conditions"]');
    if (!mount) throw new Error("The sheet has no mount point for Conditions");
    mountBlock(mount, <Conditions />);
}
