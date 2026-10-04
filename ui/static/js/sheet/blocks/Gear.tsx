// Gear and cybernetic implants. Both carry condition entries: an equipped
// gear item and every implant add them to the character (state/computed.js).
import { nanoid } from "nanoid";
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath, useSheet } from "../components/context";
import { Checkbox, NumberField, ReadonlyField, Select, TextArea, TextField, hasText } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { useItemIds } from "../components/useItemIds";
import { AutocompleteField } from "../components/AutocompleteField";
import { GEAR_TYPES, QUALITIES } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { resolvePath, valueAt } from "../state/sync";
import { ConditionEntries } from "./ConditionEntries";

const ARMOUR_LOCATIONS = ["head", "torso", "arms", "legs"] as const;

/**
 * The entries of the item at `itemPath`. The fieldset is hidden by CSS until
 * the item has an entry; the stub button adds the first one.
 */
function ItemEntries({ itemId, itemPath }: { itemId: string; itemPath: string }) {
    const { canEdit, actions } = useSheet();
    const gridPath = `${itemPath}.entries.items`;
    const { ids } = useItemIds(gridPath);
    const addFirst = () => actions.createItem(gridPath, `entries-${itemId}-${nanoid()}`, {}, { colIndex: 0, rowIndex: 0 });
    return (
        <>
            {canEdit && ids.length === 0 && <button class="add-first-condition" onClick={addFirst}>＋ condition</button>}
            <fieldset class="gear-condition-fields">
                <legend>Conditions</legend>
                <ConditionEntries itemId={itemId} />
            </fieldset>
        </>
    );
}

function ArmourRow({ dataId, label }: { dataId: string; label: string }) {
    return (
        <Scope as="tr" dataId={dataId}>
            <td class="row-label">{label}</td>
            {ARMOUR_LOCATIONS.map(loc => <td key={loc}><TextField field={loc} /></td>)}
        </Scope>
    );
}

function GearArmour() {
    return (
        <Scope as="fieldset" dataId="armour" class="gear-armour-fields">
            <legend>Armour</legend>
            <table class="gear-armour-table">
                <thead>
                    <tr><th></th><th>H</th><th>T</th><th>A</th><th>L</th></tr>
                </thead>
                <tbody>
                    <ArmourRow dataId="ap" label="AP" />
                    <ArmourRow dataId="superAp" label="SA" />
                </tbody>
            </table>
            <div class="layout-row">
                <label class="gear-armour-special">Upgrades:
                    <TextField field="upgrades" />
                </label>
            </div>
            <div class="layout-row">
                <label class="gear-armour-special">Special:
                    <TextField field="special" />
                </label>
            </div>
        </Scope>
    );
}

// Like the old items: they start collapsed without a description.
const startsCollapsedWithout = (state: SheetSignals, path: string) => () => !hasText(state, `${path}.description`);
const hasEntries = (state: SheetSignals, path: string) =>
    Object.keys((resolvePath(state, `${path}.entries.items`) as object | null) ?? {}).length > 0;

function GearItem({ itemId }: { itemId: string }) {
    const { state } = useSheet();
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => hasText(state, `${path}.description`) || hasEntries(state, path),
        startsCollapsed: startsCollapsedWithout(state, path),
    });
    const isArmour = valueAt(state, `${path}.gearType`) === "armour";

    return (
        <Scope dataId={itemId} class={collapsed ? "gear-item item-with-description collapsed" : "gear-item item-with-description"} elRef={elRef}>
            <div class="split-header">
                <AutocompleteField field="name" class="long" itemPath={path} collection="gear" />
                <Select field="quality" options={QUALITIES} class="quality-select" />
                <label>
                    <NumberField field="weight" placeholder="wt." class="short textlike" />
                </label>
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>

            <div class="collapsible-content">
                <div class="layout-row centered-content">
                    <Select field="gearType" options={GEAR_TYPES} />
                    <label>Carried:
                        <Checkbox field="carried" class="custom" />
                    </label>
                    <label>Equipped:
                        <Checkbox field="equipped" class="custom" />
                    </label>
                </div>

                {isArmour && <GearArmour />}

                <ItemEntries itemId={itemId} itemPath={path} />

                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

export function Gear() {
    return (
        <ItemGrid
            dataId="gear.list.items"
            id="gear"
            itemClass="gear-item"
            renderItem={id => <GearItem itemId={id} />}
        />
    );
}

function CyberneticImplant({ itemId }: { itemId: string }) {
    const { state } = useSheet();
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => hasText(state, `${path}.description`) || hasEntries(state, path),
        startsCollapsed: startsCollapsedWithout(state, path),
    });

    return (
        <Scope dataId={itemId} class={collapsed ? "item-with-description collapsed" : "item-with-description"} elRef={elRef}>
            <div class="split-header">
                <AutocompleteField field="name" itemPath={path} collection="cybernetics" />
                <Select field="quality" options={QUALITIES} class="quality-select" />
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="collapsible-content">
                <ItemEntries itemId={itemId} itemPath={path} />
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

export function Cybernetics() {
    return (
        <ItemGrid
            dataId="cybernetics.list.items"
            id="cybernetics"
            itemClass="item-with-description"
            renderItem={id => <CyberneticImplant itemId={id} />}
        />
    );
}

export function CarryWeight() {
    return (
        <Scope dataId="carryWeightAndEncumbrance" id="weight-bar" class="layout-column centered-bar">
            <div class="layout-row">
                <label>S.b+T.b:</label>
                <NumberField field="carryWeightBase" class="short" />
                <label>Encumbrance:</label>
                <ReadonlyField field="encumbrance" type="number" class="short" />
            </div>
            <div class="layout-row">
                <label>Carry weight:</label>
                <ReadonlyField field="carryWeight" type="number" class="short" />
                <label>Lift weight:</label>
                <ReadonlyField field="liftWeight" type="number" class="short" />
                <label>Push weight:</label>
                <ReadonlyField field="pushWeight" type="number" class="short" />
            </div>
        </Scope>
    );
}
