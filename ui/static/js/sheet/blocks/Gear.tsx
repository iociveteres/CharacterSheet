// Gear and cybernetic implants. Both carry condition entries: an equipped
// gear item and every implant add them to the character (state/computed.js).
import type { Ref, VNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { ToggleField, useCollapsible } from "../components/Collapsible";
import { joinPath, usePath, useSheet } from "../components/context";
import { Checkbox, NumberField, ReadonlyField, Select, TextArea, TextField, hasText } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { useItemIds } from "../components/useItemIds";
import { Scope } from "../components/Scope";
import { AutocompleteField } from "../components/AutocompleteField";
import { GEAR_TYPES, QUALITIES } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { gearApTotal, type GearLocation } from "../state/armour";
import { gearMods, gearWeight } from "../state/computed";
import { enchantmentsOf } from "../state/enchantments";
import { capacityTitle, hasMaterial, type GearItem } from "../state/materials";
import { linkedAttacks } from "../state/itemLink";
import { resolvePath, valueAt } from "../state/sync";
import { AddConditionButton, ItemEntries } from "./ConditionEntries";
import { AddAttackButton, LinkedAttacks, useAttackAdder } from "./LinkedAttacks";
import { Mods, type Adding } from "./Mods";

const ARMOUR_LOCATIONS = ["head", "torso", "arms", "legs"] as const;

/**
 * `total` until focused, then the own field that `own` renders, focused, to
 * edit; the own field alone while nothing changes it (`total` null).
 */
function TotalOrOwn({ total, title, totalId, class: cls, own }: {
    total: number | null;
    title: string;
    totalId: string;
    class: string;
    own: (props: { inputRef: Ref<HTMLInputElement>; onBlur: () => void }) => VNode;
}) {
    const { canEdit } = useSheet();
    const [editing, setEditing] = useState(false);
    const ownRef = useRef<HTMLInputElement>(null);
    useLayoutEffect(() => {
        if (editing) ownRef.current?.focus();
    }, [editing]);

    if (total === null || editing) return own({ inputRef: ownRef, onBlur: () => setEditing(false) });
    return (
        <input type="text" data-id={totalId} class={cls} readOnly value={total} title={title}
            onFocus={() => canEdit && setEditing(true)} />
    );
}

/** The AP of a location with the material's and Broken (state/armour.ts), the own AP on focus. */
function ApCell({ itemPath, location }: { itemPath: string; location: GearLocation }) {
    const { state } = useSheet();
    const ap = gearApTotal(resolvePath(state, itemPath) as GearItem, location);
    return (
        <TotalOrOwn total={ap?.modified ? ap.total : null} title={ap?.lines.join("\n") ?? ""} totalId={`${location}Total`} class="ap-total"
            own={props => <TextField field={location} {...props} />} />
    );
}

function ArmourRow({ dataId, label, itemPath }: { dataId: "ap" | "superAp"; label: string; itemPath: string }) {
    return (
        <Scope as="tr" dataId={dataId}>
            <td class="row-label">{label}</td>
            {ARMOUR_LOCATIONS.map(loc => (
                <td key={loc}>{dataId === "ap" ? <ApCell itemPath={itemPath} location={loc} /> : <TextField field={loc} />}</td>
            ))}
        </Scope>
    );
}

/**
 * The armour of the item, and in the same frame its enchantments, before the
 * armour's mods, and the add line of both: the enchantments are the item's,
 * outside the armour's path.
 */
function GearArmour({ itemPath, enchantments, mods, addLine }: {
    itemPath: string;
    enchantments: VNode | null;
    mods: Adding;
    addLine: VNode | null;
}) {
    return (
        <fieldset class="gear-armour-fields">
            <legend>Armour</legend>
            <Scope dataId="armour">
                <table class="gear-armour-table">
                    <thead>
                        <tr><th></th><th>H</th><th>T</th><th>A</th><th>L</th></tr>
                    </thead>
                    <tbody>
                        <ArmourRow dataId="ap" label="AP" itemPath={itemPath} />
                        <ArmourRow dataId="superAp" label="SA" itemPath={itemPath} />
                    </tbody>
                </table>
                <div class="layout-row">
                    <label class="gear-armour-special">Special:
                        <TextField field="special" />
                    </label>
                </div>
            </Scope>
            {enchantments}
            <Scope dataId="armour">
                <Mods collection="armourMods" weight entries {...mods} />
            </Scope>
            {addLine}
        </fieldset>
    );
}

/**
 * The weight of the item at `path`: while its material or mods change it,
 * the total (state/computed.ts gearWeight), the own weight to edit on focus.
 */
function GearWeight({ path }: { path: string }) {
    const { state } = useSheet();
    const item = resolvePath(state, path) as GearItem;
    const { own, factors, mods, total } = gearWeight(item);
    const title = [
        `${own} ${String(item.name?.value || "own")}`,
        ...factors.map(f => `× ${f.factor} ${f.source}`),
        ...(mods ? [`+ ${mods} mods`] : []),
        `= ${total}`,
    ].join("\n");
    return (
        <TotalOrOwn total={factors.length || mods ? total : null} title={title} totalId="weightTotal" class="short textlike weight-total"
            own={props => <NumberField field="weight" {...props} placeholder="wt." class="short textlike" />} />
    );
}

// Like the old items: they start collapsed without a description.
const startsCollapsedWithout = (state: SheetSignals, path: string) => () => !hasText(state, `${path}.description`);
const hasEntries = (state: SheetSignals, path: string) =>
    Object.keys((resolvePath(state, `${path}.entries.items`) as object | null) ?? {}).length > 0;
const hasMods = (state: SheetSignals, path: string) => {
    const item = resolvePath(state, path) as GearItem;
    return gearMods(item).length > 0 || enchantmentsOf(item).length > 0;
};

type AddingRow = "enchantments" | "mods" | null;

function GearItemView({ itemId }: { itemId: string }) {
    const { state, canEdit, gearItemParts: parts } = useSheet();
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => hasText(state, `${path}.description`) || hasEntries(state, path) || hasMods(state, path),
        startsCollapsed: startsCollapsedWithout(state, path),
    });
    const gearType = valueAt(state, `${path}.gearType`);
    const armour = gearType === "armour";
    const weapon = gearType === "weapon";
    const item = resolvePath(state, path) as GearItem;

    // An empty row of chips shows only while it adds one; its ＋ is in the add line.
    const [adding, setAdding] = useState<AddingRow>(null);
    const addingTo = (row: AddingRow): Adding => ({ adding: adding === row, setAdding: on => setAdding(on ? row : null) });
    const [materialOpen, setMaterialOpen] = useState(false);
    const adder = useAttackAdder(itemId);
    const attacks = useComputed(() => linkedAttacks(state, itemId)).value;
    const enchantmentIds = useItemIds(`${path}.enchantments.items`).ids;
    const modIds = useItemIds(`${path}.${armour ? "armour" : "weapon"}.mods.items`).ids;
    const entryIds = useItemIds(`${path}.entries.items`).ids;

    const addButtons = canEdit ? [
        weapon && attacks.length === 0 && !adder.both && <AddAttackButton key="attack" itemId={itemId} adder={adder} class="add-line-button" />,
        parts && !armour && !weapon && !materialOpen && !hasMaterial(item) && (
            <button key="material" type="button" class="add-line-button" data-id="addMaterial" onClick={() => setMaterialOpen(true)}>＋ material</button>
        ),
        parts && enchantmentIds.length === 0 && adding !== "enchantments" && (
            <button key="enchantment" type="button" class="add-line-button" data-id="addEnchantment"
                title={`Add an enchantment\n${capacityTitle(item)}`} onClick={() => setAdding("enchantments")}>＋ ench.</button>
        ),
        (armour || weapon) && modIds.length === 0 && adding !== "mods" && (
            <button key="mod" type="button" class="add-line-button" data-id="addMod" onClick={() => setAdding("mods")}>＋ mod</button>
        ),
        // Armour has its line in its frame, and ＋ condition under it.
        !armour && entryIds.length === 0 && <AddConditionButton key="condition" itemId={itemId} itemPath={path} />,
    ].filter(Boolean) : [];
    const addLine = addButtons.length ? <div class="gear-add-line" data-id="addLine">{addButtons}</div> : null;
    const enchantments = parts ? <parts.Enchantments path={path} {...addingTo("enchantments")} /> : null;

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
                <div class="layout-row centered-content gear-flags">
                    <Select field="gearType" options={GEAR_TYPES} />
                    <label>Carried
                        <Checkbox field="carried" class="custom" />
                    </label>
                    <label>Equipped
                        <Checkbox field="equipped" class="custom" />
                    </label>
                    {parts && <parts.Flags path={path} />}
                </div>
                {parts && <parts.Material path={path} open={materialOpen} setOpen={setMaterialOpen} />}

                {armour && <GearArmour itemPath={path} enchantments={enchantments} mods={addingTo("mods")} addLine={addLine} />}
                {weapon && <LinkedAttacks itemId={itemId} adder={adder} />}
                {!armour && enchantments}
                {weapon && <Scope dataId="weapon"><Mods collection="weaponMods" weight {...addingTo("mods")} /></Scope>}
                {!armour && addLine}

                <ItemEntries itemId={itemId} itemPath={path} addButton={armour} />

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
            renderItem={id => <GearItemView itemId={id} />}
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
