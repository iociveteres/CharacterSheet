// Gear and cybernetic implants. Both carry condition entries: an equipped
// gear item and every implant add them to the character (state/computed.js).
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { ToggleField, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath, useSheet } from "../components/context";
import { Checkbox, NumberField, ReadonlyField, Select, TextArea, TextField, hasText } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { AutocompleteField } from "../components/AutocompleteField";
import { GEAR_TYPES, QUALITIES } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { gearMods, modsWeight } from "../state/computed";
import { resolvePath, valueAt } from "../state/sync";
import { ItemEntries } from "./ConditionEntries";
import { Mods } from "./Mods";

type GearItemSignals = SheetSignals["gear"]["list"]["items"][string];

const ARMOUR_LOCATIONS = ["head", "torso", "arms", "legs"] as const;

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
                <label class="gear-armour-special">Special:
                    <TextField field="special" />
                </label>
            </div>
            <Mods collection="armourMods" weight entries />
        </Scope>
    );
}

/**
 * The weight of the item at `path`: with mods that weigh, their sum with the
 * item's own until focused, then the own weight to edit.
 */
function GearWeight({ path }: { path: string }) {
    const { state, canEdit } = useSheet();
    const item = resolvePath(state, path) as GearItemSignals;
    const [editing, setEditing] = useState(false);
    const ownRef = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => {
        if (editing) ownRef.current?.focus();
    }, [editing]);

    const mods = modsWeight(item);
    if (!mods || editing) {
        return <NumberField field="weight" inputRef={ownRef} placeholder="wt." class="short textlike" onBlur={() => setEditing(false)} />;
    }
    const own = Number(item.weight?.value) || 0;
    return (
        <input type="text" data-id="weightTotal" class="short textlike weight-total" readOnly
            value={(Math.round(own * 1000) + Math.round(mods * 1000)) / 1000}
            title={`${own} + ${mods} mods`}
            onFocus={() => canEdit && setEditing(true)} />
    );
}

// Like the old items: they start collapsed without a description.
const startsCollapsedWithout = (state: SheetSignals, path: string) => () => !hasText(state, `${path}.description`);
const hasEntries = (state: SheetSignals, path: string) =>
    Object.keys((resolvePath(state, `${path}.entries.items`) as object | null) ?? {}).length > 0;
const hasMods = (state: SheetSignals, path: string) => gearMods(resolvePath(state, path) as GearItemSignals).length > 0;

function GearItem({ itemId }: { itemId: string }) {
    const { state } = useSheet();
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => hasText(state, `${path}.description`) || hasEntries(state, path) || hasMods(state, path),
        startsCollapsed: startsCollapsedWithout(state, path),
    });
    const gearType = valueAt(state, `${path}.gearType`);

    return (
        <Scope dataId={itemId} class={collapsed ? "gear-item item-with-description collapsed" : "gear-item item-with-description"} elRef={elRef}>
            <div class="split-header">
                <ToggleField onToggle={toggle}>
                    <AutocompleteField field="name" class="long" itemPath={path} collection="gear" />
                </ToggleField>
                <Select field="quality" options={QUALITIES} class="quality-select" />
                <label>
                    <GearWeight path={path} />
                </label>
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

                {gearType === "armour" && <GearArmour />}
                {gearType === "weapon" && <Scope dataId="weapon"><Mods collection="weaponMods" weight /></Scope>}

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
                <ToggleField onToggle={toggle}>
                    <AutocompleteField field="name" itemPath={path} collection="cybernetics" />
                </ToggleField>
                <Select field="quality" options={QUALITIES} class="quality-select" />
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
