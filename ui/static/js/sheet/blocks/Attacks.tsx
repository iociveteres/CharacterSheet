// Ranged and melee attacks. Each has a roll dropdown under its name label;
// a melee attack has tabs of weapon profiles and, as a shield, shield fields.
import { nanoid } from "nanoid";
import { useComputed } from "@preact/signals";
import { ToggleField, useCollapsible } from "../components/Collapsible";
import { useDropdown } from "../components/Dropdown";
import { joinPath, usePath, useSheet } from "../components/context";
import { Checkbox, NumberField, Select, TextArea, TextField, hasText } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { Tabs } from "../components/Tabs";
import { AutocompleteField } from "../components/AutocompleteField";
import {
    DAMAGE_TYPES, MELEE_GROUPS, MELEE_PROFILES, MELEE_ROLL_COLUMNS, RANGED_CLASSES, RANGED_ROLL_COLUMNS, SHIELD_ARMS,
    SHIELD_SUBTYPES, type RollColumn,
} from "../schema/constants";
import { newItemOf } from "../schema/newItem";
import { ModdedField, WEAPON_FIELD } from "./ModdedField";
import { RangeField } from "./Range";
import { ReloadField } from "./Reload";
import { GripRow, MeleeRangeField } from "./Grips";
import { AttackLinkMark, ItemProperties, damageRollLabel, useInGear, useLinkMark } from "./ItemLink";
import { applyMeleeEntry, useInTraits } from "./TraitLink";
import { MELEE_ATTACKS, RANGED_ATTACKS } from "../state/itemLink";
import { MACE_PROFILE } from "../state/grips";
import { gripProperties, heldGrip, meleeAttackBonus } from "../state/melee";
import { meleeRollName, stanceOf, stanceTitle } from "../state/stances";
import { STRENGTH_BONUS, WEAPON_DAMAGE, modsAt, modsGrid, profileLabel } from "../state/damage";
import { idsInOrder } from "../state/gridOrder";
import { peekAt, textAt, valueAt } from "../state/sync";
import { rollBonusSuccesses } from "../state/rollBase";
import { firstTestOption } from "../state/testOptions";
import { meleeAttack, rangedAttack, type SheetSignals } from "../schema/sheet";
import type { RollDefaults } from "../payload";
import {
    DamageLabel, ExtraModifier, RadioColumn, RollResult, RollToggleLabel, TestSelect,
    attackTotal, extraNames, rollLabel, selectedNames, useRollTest,
} from "./rollParts";

export interface AttackRollProps {
    path: string;
    open: boolean;
    close: () => void;
    columns: readonly RollColumn[];
    block: "rangedAttacks" | "meleeAttacks";
    /** Classes next to roll-dropdown. */
    class?: string;
}

/** The roll dropdown of an attack: its columns, the extra modifiers and the result on one of its block's test options. */
export function AttackRoll({ path, open, close, columns, block, class: cls }: AttackRollProps) {
    const { state, rolls } = useSheet();
    const rollPath = `${path}.roll`;
    const test = useRollTest(block, rollPath);
    const total = useComputed(() => (block === "rangedAttacks"
        ? attackTotal(state, rollPath, test.value ?? "", columns, "ranged")
        : attackTotal(state, rollPath, test.value ?? "", columns, "melee") + meleeAttackBonus(state, path)));
    const roll = () => {
        const typed = String(peekAt(state, `${path}.name`) || "Unknown");
        const name = block === "meleeAttacks" ? meleeRollName(state, path, typed) : typed;
        const label = rollLabel(name, [...selectedNames(state, rollPath, columns), ...extraNames(state, rollPath)]);
        void rolls.versus(total.peek(), rollBonusSuccesses(state, test.peek()), label);
        close();
    };
    const classes = cls ? `roll-dropdown ${cls}` : "roll-dropdown";
    return (
        <Scope dataId="roll" class={open ? `${classes} visible` : classes}>
            {columns.map(column => <RadioColumn key={column.key} column={column} />)}
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult total={total} onRoll={roll} disabled={test.value === null}>
                {block === "meleeAttacks" && <NoAttacks />}
                <TestSelect block={block} />
            </RollResult>
        </Scope>
    );
}

/** In the Defensive stance the rules allow no attacks: a dimmed note, the roll still works. */
function NoAttacks() {
    const { state } = useSheet();
    if (stanceOf(state).key !== "defensive") return null;
    return <span class="dimmed no-attacks" title={stanceTitle(stanceOf(state), null)}>No attacks</span>;
}

// ─── Ranged ──────────────────────────────────────────────────────────────────

export const newRangedAttack = (state: SheetSignals, rolls: RollDefaults) =>
    ({ ...newItemOf(rangedAttack), roll: { ...rolls.rangedAttack, testOption: firstTestOption(state, "rangedAttacks") } });

/** A labelled row of fields, e.g. "Damage:" and its input. */
export function Row({ cls, label, children }: { cls: string; label: preact.ComponentChildren; children: preact.ComponentChildren }) {
    return (
        <div class={`layout-row ${cls}`}>
            {typeof label === "string" ? <label>{label}</label> : label}
            {children}
        </div>
    );
}

function RangedAttack({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { state, rollDefaults } = useSheet();
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => hasText(state, `${path}.description`) });
    // The roll dropdown closes on a click outside the item.
    const dropdown = useDropdown(elRef);
    const hasRoll = valueAt(state, `${path}.roll.testOption`) !== undefined;
    const base = () => newRangedAttack(state, rollDefaults);
    const inGear = useInGear(path, RANGED_ATTACKS, "ranged", base);
    const link = useLinkMark(path);

    return (
        <Scope dataId={itemId} class={collapsed ? "ranged-attack item-with-description collapsed" : "ranged-attack item-with-description"} elRef={elRef}>
            <div class="layout-row split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <ToggleField onToggle={toggle}>
                        <AutocompleteField field="name" class="long-input" itemPath={path} collection="ranged" base={base} local={[inGear]}
                            title={link?.title} />
                        <AttackLinkMark attackPath={path} mark={link} />
                    </ToggleField>
                </div>
                <Row cls="class" label="Class:"><Select field="class" options={RANGED_CLASSES} /></Row>
                <DragHandle />
                <DeleteButton itemPath={path} />
                {hasRoll && dropdown.open && <AttackRoll path={path} open close={dropdown.close} columns={RANGED_ROLL_COLUMNS} block="rangedAttacks" />}
            </div>
            <div class="layout-row">
                <Row cls="range" label="Range:"><RangeField /></Row>
                <Row cls="damage" label={<DamageLabel owner={WEAPON_DAMAGE} itemPath={path} label={() => damageRollLabel(state, path, String(peekAt(state, `${path}.name`) || "Ranged Attack"))} />}>
                    <ModdedField stat="damage" owner={WEAPON_FIELD} />
                </Row>
                <Row cls="pen" label="Pen:"><ModdedField stat="pen" owner={WEAPON_FIELD} /></Row>
                <Row cls="damage-type" label="Type:"><Select field="damageType" options={DAMAGE_TYPES} /></Row>
            </div>
            <div class="layout-row">
                <Row cls="rof" label="RoF:">
                    <TextField field="rofSingle" />/
                    <TextField field="rofShort" class="shorter-input" />/
                    <TextField field="rofLong" class="shorter-input" />
                </Row>
                <Row cls="clip" label="Clip:">
                    <TextField field="clipCur" />/
                    <TextField field="clipMax" />
                </Row>
                <Row cls="reload" label="Reload:"><ReloadField /></Row>
            </div>
            <div class="layout-row">
                <Row cls="special" label="Special:">
                    <TextField field="special" />
                    <ItemProperties weaponPath={path} />
                </Row>
            </div>
            <div class="collapsible-content">
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

export function RangedAttacks() {
    const { state, rollDefaults } = useSheet();
    return (
        <ItemGrid
            dataId="rangedAttacks.list.items"
            id="ranged-attack"
            itemClass="ranged-attack"
            newItem={() => newRangedAttack(state, rollDefaults)}
            renderItem={id => <RangedAttack itemId={id} />}
        />
    );
}

// ─── Melee ───────────────────────────────────────────────────────────────────

/** A new melee attack: one Mace profile tab with the Strength bonus and the default roll. */
export function newMeleeAttack(state: SheetSignals, rolls: RollDefaults) {
    const tabId = `tab-${nanoid()}`;
    return {
        ...newMeleeAttackBase(state, rolls),
        tabs: {
            items: { [tabId]: { profile: "mace", damageMods: modsGrid([STRENGTH_BONUS], "damage") } },
            layouts: { [tabId]: { colIndex: 0, rowIndex: 0 } },
        },
    };
}

/** A new profile tab of the melee attack at `attackPath`: the modifiers of its first tab, the Strength bonus without one. */
function newMeleeProfile(state: SheetSignals, attackPath: string) {
    const tabsPath = `${attackPath}.tabs.items`;
    const [first] = idsInOrder(state, tabsPath);
    if (!first) return { damageMods: modsGrid([STRENGTH_BONUS], "damage") };
    const from = `${tabsPath}.${first}`;
    return { damageMods: modsGrid(modsAt(state, from, "damage"), "damage"), penMods: modsGrid(modsAt(state, from, "pen"), "pen") };
}

/** What an autocompleted melee attack starts from; the collection entry brings its tabs. */
export const newMeleeAttackBase = (state: SheetSignals, rolls: RollDefaults) =>
    ({ ...newItemOf(meleeAttack), roll: { ...rolls.meleeAttack, testOption: firstTestOption(state, "meleeAttacks") } });

/** What the zones of a shield in brackets do in the stance of the sheet; none without such zones. */
function ZonesNote({ attackPath }: { attackPath: string }) {
    const { state } = useSheet();
    const zones = textAt(state, `${attackPath}.shield.defenseSectors`).match(/\([^)]*\)/g);
    if (!zones) return null;
    const on = stanceOf(state).key === "defensive";
    return (
        <span class={on ? "zones-note on" : "zones-note"} data-id="zonesNote"
            title="The zones in brackets cover only in the Defensive stance, chosen over the melee attacks">
            {on ? `${zones.join("")} covered: Defensive stance` : `${zones.join("")} only in Defensive stance`}
        </span>
    );
}

function ShieldFields({ attackPath }: { attackPath: string }) {
    return (
        <Scope as="fieldset" dataId="shield" class="shield-fields">
            <legend>Shield</legend>
            <div class="layout-row">
                <label>Type:
                    <Select field="subtype" options={SHIELD_SUBTYPES} />
                </label>
                <label>AP:
                    <NumberField field="ap" />
                </label>
                <label>Zones:
                    <TextField field="defenseSectors" />
                </label>
            </div>
            <div class="layout-row centered-content">
                <label>Arm:
                    <Select field="arm" options={SHIELD_ARMS} />
                </label>
                <label>Equipped:
                    <Checkbox field="equipped" class="custom" />
                </label>
                <ZonesNote attackPath={attackPath} />
            </div>
        </Scope>
    );
}

/** The profile select of a tab: the Mace's in Mordhau; dimmed when the grip does not allow it, as Fist all but three. */
function ProfileLabel({ attackPath, tabId }: { attackPath: string; tabId: string }) {
    const { state } = useSheet();
    const { held, effects } = useComputed(() => heldGrip(state, attackPath)).value;
    if (effects.mace) {
        return <select disabled class="mace-profile" title={MACE_TITLE}><option>Mace</option></select>;
    }
    const profile = textAt(state, `${attackPath}.tabs.items.${tabId}.profile`);
    const allowed = !effects.profiles || effects.profiles.includes(profile);
    return (
        <Select field="profile" options={MELEE_PROFILES} class={allowed ? undefined : "dimmed"}
            title={allowed ? undefined : `${held?.id} uses only the ${effects.profiles!.join(", ")} profiles`} />
    );
}

const MACE_TITLE = "Mordhau: the profile of the one-handed Mace";

function ProfilePanel({ attackPath, tabId }: { attackPath: string; tabId: string }) {
    const { state } = useSheet();
    const tabPath = `${attackPath}.tabs.items.${tabId}`;
    const mace = useComputed(() => heldGrip(state, attackPath).effects.mace).value;
    const added = useComputed(() => gripProperties(state, tabPath)).value;
    const held = useComputed(() => heldGrip(state, attackPath).held?.id ?? "").value;
    const damageLabel = () => damageRollLabel(state, tabPath, profileLabel(
        String(peekAt(state, `${attackPath}.name`) || "Melee Attack"),
        mace ? MACE_PROFILE.profile : String(peekAt(state, `${tabPath}.profile`) ?? ""),
    ));
    return (
        <div class="profile-tab">
            <div class="layout-row">
                <Row cls="range" label="Range:"><MeleeRangeField /></Row>
                <Row cls="damage" label={<DamageLabel owner={WEAPON_DAMAGE} itemPath={tabPath} label={damageLabel} />}>
                    <ModdedField stat="damage" owner={WEAPON_FIELD} />
                </Row>
                <Row cls="pen" label="Pen:"><ModdedField stat="pen" owner={WEAPON_FIELD} /></Row>
                <Row cls="damage-type" label="Type:">
                    {mace
                        ? <select disabled title={MACE_TITLE}><option>{MACE_PROFILE.damageType}</option></select>
                        : <Select field="damageType" options={DAMAGE_TYPES} />}
                </Row>
            </div>
            <div class="layout-row">
                <Row cls="special" label="Special:">
                    {mace
                        ? <input type="text" class="uneditable" readOnly tabIndex={-1} value={MACE_PROFILE.special} title={MACE_TITLE} />
                        : <TextField field="special" />}
                    {added.length > 0 && <span class="added-property" data-id="addedProperties" title={`Added by the ${held} grip`}>{`+ ${added.join(", ")}`}</span>}
                    <ItemProperties weaponPath={tabPath} />
                </Row>
            </div>
        </div>
    );
}

function MeleeAttack({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const env = useSheet();
    const { state, rollDefaults } = env;
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => hasText(state, `${path}.description`) });
    // The roll dropdown closes on a click outside the item.
    const dropdown = useDropdown(elRef);
    const hasRoll = valueAt(state, `${path}.roll.testOption`) !== undefined;
    const isShield = valueAt(state, `${path}.group`) === "primary (shield)";
    const base = () => newMeleeAttackBase(state, rollDefaults);
    const inGear = useInGear(path, MELEE_ATTACKS, "melee", base);
    const inTraits = useInTraits(path, base);
    const link = useLinkMark(path);

    return (
        <Scope dataId={itemId} class={collapsed ? "melee-attack item-with-description collapsed" : "melee-attack item-with-description"} elRef={elRef}>
            <div class="layout-row split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <ToggleField onToggle={toggle}>
                        <AutocompleteField field="name" class="long-input" itemPath={path} collection="melee" base={base}
                            local={[inGear, inTraits]} apply={r => applyMeleeEntry(env, path, base, r)} title={link?.title} />
                        <AttackLinkMark attackPath={path} mark={link} />
                    </ToggleField>
                </div>
                <div class="layout-row group">
                    <label>Group:</label>
                    <Select field="group" options={MELEE_GROUPS} />
                    <DragHandle />
                    <DeleteButton itemPath={path} />
                </div>
                {hasRoll && dropdown.open && <AttackRoll path={path} open close={dropdown.close} columns={MELEE_ROLL_COLUMNS} block="meleeAttacks" class="melee" />}
            </div>
            <GripRow attackPath={path} />
            {isShield && <ShieldFields attackPath={path} />}
            <Tabs
                dataId="tabs.items"
                group={itemId}
                renderLabel={tabId => <ProfileLabel attackPath={path} tabId={tabId} />}
                renderPanel={tabId => <ProfilePanel attackPath={path} tabId={tabId} />}
                newItem={() => newMeleeProfile(state, path)}
            />
            <div class="collapsible-content">
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

export function MeleeAttacks() {
    const { state, rollDefaults } = useSheet();
    return (
        <ItemGrid
            dataId="meleeAttacks.list.items"
            id="melee-attack"
            itemClass="melee-attack"
            newItem={() => newMeleeAttack(state, rollDefaults)}
            renderItem={id => <MeleeAttack itemId={id} />}
        />
    );
}
