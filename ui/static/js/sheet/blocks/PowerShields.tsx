import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath } from "../components/context";
import { Select, TextArea, TextField, hasText, peekAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { AutocompleteField } from "../components/useAutocomplete";
import { rollExact } from "../rollEvents";
import { nameAndTypeOption } from "./autocompleteOptions";

const NATURES = [{ value: "tech", label: "Tech" }, { value: "arcane", label: "Arcane" }];
const TYPES = [
    { value: "dome", label: "Dome" },
    { value: "phase", label: "Phase" },
    { value: "deflector", label: "Deflector" },
];

function PowerShield({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => hasText(`${path}.rating`) || hasText(`${path}.description`),
    });
    const text = (field: string) => String(peekAt(`${path}.${field}`) ?? "").trim();
    const roll = () => rollExact("d100", [text("name"), text("rating")].filter(Boolean).join(" "));

    return (
        <Scope dataId={itemId} class={collapsed ? "power-shield item-with-description collapsed" : "power-shield item-with-description"} elRef={elRef}>
            <div class="split-header">
                <div class="layout-row name">
                    <label class="rollable" onClick={roll}>Name:</label>
                    <AutocompleteField field="name" itemPath={path} collection="powerShields" renderOption={nameAndTypeOption} />
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
                        <Select field="nature" options={NATURES} />
                    </div>
                    <div class="layout-row type">
                        <label>Type:</label>
                        <Select field="type" options={TYPES} />
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
            columns={1}
            itemClass="power-shield"
            renderItem={id => <PowerShield itemId={id} />}
        />
    );
}
