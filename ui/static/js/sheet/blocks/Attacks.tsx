// Ranged and melee attacks. Each has a roll dropdown under its name label;
// a melee attack has tabs of weapon profiles and, as a shield, shield fields.
import { nanoid } from "nanoid";
import { useComputed } from "@preact/signals";
import { ToggleButton, useCollapsible } from "../components/Collapsible";
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
import { STRENGTH_BONUS, WEAPON_DAMAGE, modsAt, modsGrid, profileLabel } from "../state/damage";
import { idsInOrder } from "../state/gridOrder";
import { peekAt, valueAt } from "../state/sync";
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
    const total = useComputed(() => attackTotal(state, rollPath, test.value ?? "", columns, block === "rangedAttacks" ? "ranged" : "melee"));
    const roll = () => {
        const name = String(peekAt(state, `${path}.name`) || "Unknown");
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
            <RollResult total={total} onRoll={roll} disabled={test.value === null}><TestSelect block={block} /></RollResult>
        </Scope>
    );
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

    return (
        <Scope dataId={itemId} class={collapsed ? "ranged-attack item-with-description collapsed" : "ranged-attack item-with-description"} elRef={elRef}>
            <div class="layout-row split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <AutocompleteField field="name" class="long-input" itemPath={path} collection="ranged"
                        base={() => newRangedAttack(state, rollDefaults)} />
                </div>
                <ToggleButton onToggle={toggle} />
                <Row cls="class" label="Class:"><Select field="class" options={RANGED_CLASSES} /></Row>
                <DragHandle />
                <DeleteButton itemPath={path} />
                {hasRoll && dropdown.open && <AttackRoll path={path} open close={dropdown.close} columns={RANGED_ROLL_COLUMNS} block="rangedAttacks" />}
            </div>
            <div class="layout-row">
                <Row cls="range" label="Range:"><TextField field="range" /></Row>
                <Row cls="damage" label={<DamageLabel owner={WEAPON_DAMAGE} itemPath={path} label={() => String(peekAt(state, `${path}.name`) || "Ranged Attack")} />}>
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
                <Row cls="reload" label="Reload:"><TextField field="reload" /></Row>
            </div>
            <div class="layout-row">
                <Row cls="special" label="Special:"><TextField field="special" /></Row>
            </div>
            <div class="layout-row">
                <Row cls="upgrades" label="Upgrades:"><TextField field="upgrades" /></Row>
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
const newMeleeAttackBase = (state: SheetSignals, rolls: RollDefaults) =>
    ({ ...newItemOf(meleeAttack), roll: { ...rolls.meleeAttack, testOption: firstTestOption(state, "meleeAttacks") } });

function ShieldFields() {
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
                <label>Defensive:
                    <Checkbox field="defensive" class="custom" />
                </label>
            </div>
        </Scope>
    );
}

function ProfilePanel({ attackPath, tabId }: { attackPath: string; tabId: string }) {
    const { state } = useSheet();
    const damageLabel = () => profileLabel(
        String(peekAt(state, `${attackPath}.name`) || "Melee Attack"),
        String(peekAt(state, `${attackPath}.tabs.items.${tabId}.profile`) ?? ""),
    );
    return (
        <div class="profile-tab">
            <div class="layout-row">
                <Row cls="range" label="Range:"><TextField field="range" /></Row>
                <Row cls="damage" label={<DamageLabel owner={WEAPON_DAMAGE} itemPath={`${attackPath}.tabs.items.${tabId}`} label={damageLabel} />}>
                    <ModdedField stat="damage" owner={WEAPON_FIELD} />
                </Row>
                <Row cls="pen" label="Pen:"><ModdedField stat="pen" owner={WEAPON_FIELD} /></Row>
                <Row cls="damage-type" label="Type:"><Select field="damageType" options={DAMAGE_TYPES} /></Row>
            </div>
            <div class="layout-row">
                <Row cls="special" label="Special:"><TextField field="special" /></Row>
            </div>
        </div>
    );
}

function MeleeAttack({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { state, rollDefaults } = useSheet();
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => hasText(state, `${path}.description`) });
    // The roll dropdown closes on a click outside the item.
    const dropdown = useDropdown(elRef);
    const hasRoll = valueAt(state, `${path}.roll.testOption`) !== undefined;
    const isShield = valueAt(state, `${path}.group`) === "primary (shield)";

    return (
        <Scope dataId={itemId} class={collapsed ? "melee-attack item-with-description collapsed" : "melee-attack item-with-description"} elRef={elRef}>
            <div class="layout-row split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <AutocompleteField field="name" class="long-input" itemPath={path} collection="melee"
                        base={() => newMeleeAttackBase(state, rollDefaults)} />
                </div>
                <ToggleButton onToggle={toggle} />
                <div class="layout-row group">
                    <label>Group:</label>
                    <Select field="group" options={MELEE_GROUPS} />
                    <DragHandle />
                    <DeleteButton itemPath={path} />
                </div>
                {hasRoll && dropdown.open && <AttackRoll path={path} open close={dropdown.close} columns={MELEE_ROLL_COLUMNS} block="meleeAttacks" class="melee" />}
            </div>
            <div class="layout-row">
                <Row cls="grip" label="Grips:"><TextField field="grip" /></Row>
                <Row cls="balance" label="Balance:"><TextField field="balance" /></Row>
            </div>
            <div class="layout-row">
                <Row cls="upgrades" label="Upgrades:"><TextField field="upgrades" /></Row>
            </div>
            {isShield && <ShieldFields />}
            <Tabs
                dataId="tabs.items"
                group={itemId}
                renderLabel={() => <Select field="profile" options={MELEE_PROFILES} />}
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
