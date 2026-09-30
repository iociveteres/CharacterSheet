import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath, useSheet } from "../components/context";
import { Select, TextArea, TextField, hasText } from "../components/fields";
import { peekAt } from "../state/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { AutocompleteField } from "../components/AutocompleteField";
import { POWER_SHIELD_NATURES, POWER_SHIELD_TYPES } from "../schema/constants";

function PowerShield({ itemId }: { itemId: string }) {
    const { state, rolls } = useSheet();
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => hasText(state, `${path}.rating`) || hasText(state, `${path}.description`),
    });
    const text = (field: string) => String(peekAt(state, `${path}.${field}`) ?? "").trim();
    const roll = () => void rolls.exact("d100", [text("name"), text("rating")].filter(Boolean).join(" "));

    return (
        <Scope dataId={itemId} class={collapsed ? "power-shield item-with-description collapsed" : "power-shield item-with-description"} elRef={elRef}>
            <div class="split-header">
                <div class="layout-row name">
                    <label class="rollable" onClick={roll}>Name:</label>
                    <AutocompleteField field="name" itemPath={path} collection="powerShields" />
                </div>
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>

            <div class="collapsible-content">
                <div class="layout-row">
                    <div class="layout-row rating">
                        <label>Rating:</label>
                        <TextField field="rating" />
                    </div>
                    <div class="layout-row nature">
                        <label>Nature:</label>
                        <Select field="nature" options={POWER_SHIELD_NATURES} />
                    </div>
                    <div class="layout-row type">
                        <label>Type:</label>
                        <Select field="type" options={POWER_SHIELD_TYPES} />
                    </div>
                </div>
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

export function PowerShields() {
    return (
        <ItemGrid
            dataId="powerShields.list.items"
            id="power-shields"
            itemClass="power-shield"
            renderItem={id => <PowerShield itemId={id} />}
        />
    );
}
