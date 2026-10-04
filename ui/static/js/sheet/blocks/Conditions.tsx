// The Conditions block in the Characteristics dropdown and in ConditionsControl.
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath, useSheet } from "../components/context";
import { Copyable } from "../components/Copyable";
import { Checkbox, NumberField } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { AutocompleteField } from "../components/AutocompleteField";
import { resolvePath } from "../state/sync";
import { conditionFactory } from "../factories/condition";
import { ConditionEntries } from "./ConditionEntries";
import { nameOption } from "../components/autocompleteOptions";

const COLLECTION = "conditions";

export function ConditionItem({ itemId }: { itemId: string }) {
    const { state } = useSheet();
    const path = joinPath(usePath(), itemId);
    // As for old items: a condition without entries has nothing to show and starts collapsed.
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => Object.keys((resolvePath(state, `${path}.entries.items`) as object | null) ?? {}).length > 0,
    });

    return (
        <Scope dataId={itemId} class={collapsed ? "condition-item collapsed" : "condition-item"} elRef={elRef}>
            <div class="split-header">
                <Checkbox field="enabled" class="custom" />
                <AutocompleteField field="name" class="long textlike" itemPath={path} collection={COLLECTION} renderOption={nameOption} />
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
                columnClass="condition-column"
                itemClass="condition-item"
                newItem={conditionFactory}
                renderItem={id => <ConditionItem itemId={id} />}
            />
        </div>
    );
}
