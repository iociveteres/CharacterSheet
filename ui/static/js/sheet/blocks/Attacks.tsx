// Ranged and melee attacks. Each has a roll dropdown under its name label;
// a melee attack has tabs of weapon profiles and, as a shield, shield fields.
import { nanoid } from "nanoid";
import { useComputed } from "@preact/signals";
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { useDropdown } from "../components/Dropdown";
import { joinPath, usePath, useSheet } from "../components/context";
import { Checkbox, NumberField, Select, TextArea, TextField, hasText, peekAt, valueAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { Tabs } from "../components/Tabs";
import { AutocompleteField } from "../components/useAutocomplete";
import {
    DAMAGE_TYPES, MELEE_BASE_SELECTS, MELEE_GROUPS, MELEE_PROFILES, MELEE_ROLL_COLUMNS, RANGED_BASE_SELECTS, RANGED_CLASSES,
    RANGED_ROLL_COLUMNS, SHIELD_ARMS, SHIELD_SUBTYPES, type Option, type RollColumn,
} from "../schema/constants";
import { newItemOf } from "../schema/newItem";
import { meleeAttack, rangedAttack } from "../schema/sheet";
import type { RollDefaults } from "../current";
import {
    BaseSelect, DamageLabel, ExtraModifier, RadioColumn, RollResult, RollToggleLabel,
    attackTotal, extraNames, rollLabel, rollTotal, selectedNames,
} from "./rollParts";

interface AttackRollProps {
    path: string;
    open: boolean;
    close: () => void;
    columns: readonly RollColumn[];
    baseSelects: readonly Option[];
    /** Classes next to roll-dropdown. */
    class?: string;
}

/** The roll dropdown of an attack: its columns, the extra modifiers and the result. */
function AttackRoll({ path, open, close, columns, baseSelects, class: cls }: AttackRollProps) {
    const rollPath = `${path}.roll`;
    const total = useComputed(() => attackTotal(rollPath, columns));
    const roll = () => {
        const name = String(peekAt(`${path}.name`) || "Unknown");
        rollTotal(rollPath, total.peek(), rollLabel(name, [...selectedNames(rollPath, columns), ...extraNames(rollPath)]));
        close();
    };
    const classes = cls ? `roll-dropdown ${cls}` : "roll-dropdown";
    return (
        <Scope dataId="roll" class={open ? `${classes} visible` : classes}>
            {columns.map(column => <RadioColumn key={column.key} column={column} />)}
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult total={total} onRoll={roll}><BaseSelect options={baseSelects} /></RollResult>
        </Scope>
    );
}

// ─── Ranged ──────────────────────────────────────────────────────────────────

export const newRangedAttack = (rolls: RollDefaults) => ({ ...newItemOf(rangedAttack), roll: rolls.rangedAttack });

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
    const { rollDefaults } = useSheet();
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => hasText(`${path}.description`) });
    // The roll dropdown closes on a click outside the item.
    const dropdown = useDropdown(elRef);
    const hasRoll = valueAt(`${path}.roll.baseSelect`) !== undefined;

    return (
        <Scope dataId={itemId} class={collapsed ? "ranged-attack item-with-description collapsed" : "ranged-attack item-with-description"} elRef={elRef}>
            <div class="layout-row split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <AutocompleteField field="name" class="long-input" itemPath={path} collection="ranged"
                        base={() => newRangedAttack(rollDefaults)} />
                </div>
                <ToggleButton onToggle={toggle} />
                <Row cls="class" label="Class:"><Select field="class" options={RANGED_CLASSES} /></Row>
                <DragHandle />
                <DeleteButton itemPath={path} />
                {hasRoll && <AttackRoll path={path} open={dropdown.open} close={dropdown.close} columns={RANGED_ROLL_COLUMNS} baseSelects={RANGED_BASE_SELECTS} />}
            </div>
            <div class="layout-row">
                <Row cls="range" label="Range:"><TextField field="range" /></Row>
                <Row cls="damage" label={<DamageLabel damagePath={`${path}.damage`} label={() => String(peekAt(`${path}.name`) || "Ranged Attack")} />}>
                    <TextField field="damage" />
                </Row>
                <Row cls="pen" label="Pen:"><TextField field="pen" /></Row>
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
    const { rollDefaults } = useSheet();
    return (
        <ItemGrid
            dataId="rangedAttacks.list.items"
            id="ranged-attack"
            itemClass="ranged-attack"
            newItem={() => newRangedAttack(rollDefaults)}
            renderItem={id => <RangedAttack itemId={id} />}
        />
    );
}

// ─── Melee ───────────────────────────────────────────────────────────────────

/** A new melee attack: one Mace profile tab and the default roll. */
export function newMeleeAttack(rolls: RollDefaults) {
    const tabId = `tab-${nanoid()}`;
    return {
        ...newMeleeAttackBase(rolls),
        tabs: { items: { [tabId]: { profile: "mace" } }, layouts: { [tabId]: { colIndex: 0, rowIndex: 0 } } },
    };
}

/** What an autocompleted melee attack starts from; the collection entry brings its tabs. */
const newMeleeAttackBase = (rolls: RollDefaults) => ({ ...newItemOf(meleeAttack), roll: rolls.meleeAttack });

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
    const damageLabel = () => {
        const weapon = String(peekAt(`${attackPath}.name`) || "Melee Attack");
        const profile = String(peekAt(`${attackPath}.tabs.items.${tabId}.profile`) ?? "");
        return profile && profile !== "no" ? `${weapon}, ${profile}` : weapon;
    };
    return (
        <div class="profile-tab">
            <div class="layout-row">
                <Row cls="range" label="Range:"><TextField field="range" /></Row>
                <Row cls="damage" label={<DamageLabel damagePath={`${attackPath}.tabs.items.${tabId}.damage`} label={damageLabel} />}>
                    <TextField field="damage" />
                </Row>
                <Row cls="pen" label="Pen:"><TextField field="pen" /></Row>
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
    const { rollDefaults } = useSheet();
    const { collapsed, toggle, elRef } = useCollapsible(path, { hasContent: () => hasText(`${path}.description`) });
    // The roll dropdown closes on a click outside the item.
    const dropdown = useDropdown(elRef);
    const hasRoll = valueAt(`${path}.roll.baseSelect`) !== undefined;
    const isShield = valueAt(`${path}.group`) === "primary (shield)";

    return (
        <Scope dataId={itemId} class={collapsed ? "melee-attack item-with-description collapsed" : "melee-attack item-with-description"} elRef={elRef}>
            <div class="layout-row split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <AutocompleteField field="name" class="long-input" itemPath={path} collection="melee"
                        base={() => newMeleeAttackBase(rollDefaults)} />
                </div>
                <ToggleButton onToggle={toggle} />
                <div class="layout-row group">
                    <label>Group:</label>
                    <Select field="group" options={MELEE_GROUPS} />
                    <DragHandle />
                    <DeleteButton itemPath={path} />
                </div>
                {hasRoll && <AttackRoll path={path} open={dropdown.open} close={dropdown.close} columns={MELEE_ROLL_COLUMNS} baseSelects={MELEE_BASE_SELECTS} class="melee" />}
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
            />
            <div class="collapsible-content">
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

export function MeleeAttacks() {
    const { rollDefaults } = useSheet();
    return (
        <ItemGrid
            dataId="meleeAttacks.list.items"
            id="melee-attack"
            itemClass="melee-attack"
            newItem={() => newMeleeAttack(rollDefaults)}
            renderItem={id => <MeleeAttack itemId={id} />}
        />
    );
}
