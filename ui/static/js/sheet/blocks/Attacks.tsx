// Ranged and melee attacks. Each has a roll dropdown under its name label;
// a melee attack has tabs of weapon profiles and, as a shield, shield fields.
import { nanoid } from "nanoid";
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { useDropdown } from "../components/Dropdown";
import { joinPath, usePath } from "../components/context";
import { Checkbox, NumberField, Select, TextArea, TextField, hasText, peekAt, valueAt, type Option } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { Tabs } from "../components/Tabs";
import { AutocompleteField } from "../components/useAutocomplete";
import { newItemOf } from "../schema/newItem";
import { meleeAttack, rangedAttack } from "../schema/sheet";
import { readSheetState } from "../state/sheetState";
import { nameAndTypeOption } from "./autocompleteOptions";
import {
    BaseSelect, DamageLabel, ExtraModifier, RadioColumn, RollResult, RollToggleLabel,
    extraNames, rollLabel, rollTotal, selectedNames, type ColumnOption,
} from "./rollParts";

export const DAMAGE_TYPES: readonly string[] = ["I", "I(Cr)", "R", "X", "X(Fr)", "E", "E(El)", "E(Ls)", "E(Fl)", "C", "C(Tx)"];

const AIM: readonly ColumnOption[] = [["no", "no", "No"], ["half", "half", "Half"], ["full", "full", "Full"]];

const TARGET: readonly ColumnOption[] = [
    ["no", "no", "No"], ["torso", "torso", "Torso"], ["leg", "leg", "Leg"], ["arm", "arm", "Arm"],
    ["head", "head", "Head"], ["joint", "joint", "Joint"], ["eyes", "eyes", "Eyes"],
];

const AIM_TARGET_NAMES = {
    aim: { default: "no", names: { half: "half aim", full: "full aim" } },
    target: { default: "no", names: {} },
};

/** A new attack of `spec` with the roll settings new attacks start with. */
const withRollDefaults = <T extends object>(item: T, roll: object) => ({ ...item, roll });

// ─── Ranged ──────────────────────────────────────────────────────────────────

const RANGED_CLASSES: readonly Option[] = [
    { value: "pistol", label: "Pistol" },
    { value: "rifle", label: "Rifle" },
    { value: "long rifle", label: "Long Rifle" },
    { value: "heavy", label: "Heavy" },
    { value: "throwing", label: "Throwing" },
    { value: "grenade", label: "Grenade" },
    { value: "special", label: "Special" },
];

const RANGED_BASE: readonly Option[] = ["BS", "I", "P", "W", "F", { value: "acrobatics", label: "Acrobatics" }];

const RANGE: readonly ColumnOption[] = [
    ["melee", "melee", "Melee"], ["point-blank", "pointBlank", "Point-blank"], ["short", "short", "Short"],
    ["combat", "combat", "Combat"], ["long", "long", "Long"], ["extreme", "extreme", "Extreme"],
];

const RANGED_ROF: readonly ColumnOption[] = [
    ["single", "single", "Single"], ["short", "short", "Short"], ["long", "long", "Long"], ["suppression", "suppression", "Suppression"],
];

const RANGED_NAMES = {
    ...AIM_TARGET_NAMES,
    range: { default: "combat", names: {} },
    rof: { default: "single", names: { single: "single shot", short: "short burst", long: "long burst" } },
};

export const newRangedAttack = () => withRollDefaults(newItemOf(rangedAttack), readSheetState().rollDefaults.rangedAttack);

function RangedRoll({ path, open, close }: { path: string; open: boolean; close: () => void }) {
    const rollPath = `${path}.roll`;
    const roll = () => {
        const name = String(peekAt(`${path}.name`) || "Unknown");
        rollTotal(rollPath, rollLabel(name, [...selectedNames(rollPath, RANGED_NAMES), ...extraNames(rollPath)]));
        close();
    };
    return (
        <Scope dataId="roll" class={open ? "roll-dropdown visible" : "roll-dropdown"}>
            <RadioColumn dataId="aim" label="Aim" options={AIM} />
            <RadioColumn dataId="target" label="Target" options={TARGET} />
            <RadioColumn dataId="range" label="Range" options={RANGE} />
            <RadioColumn dataId="rof" label="RoF" options={RANGED_ROF} />
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult onRoll={roll}><BaseSelect options={RANGED_BASE} /></RollResult>
        </Scope>
    );
}

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
                        renderOption={nameAndTypeOption} base={newRangedAttack} />
                </div>
                <ToggleButton onToggle={toggle} />
                <Row cls="class" label="Class:"><Select field="class" options={RANGED_CLASSES} /></Row>
                <DragHandle />
                <DeleteButton itemPath={path} />
                {hasRoll && <RangedRoll path={path} open={dropdown.open} close={dropdown.close} />}
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
    return (
        <ItemGrid
            dataId="rangedAttacks.list.items"
            id="ranged-attack"
            columns={1}
            itemClass="ranged-attack"
            newItem={newRangedAttack}
            renderItem={id => <RangedAttack itemId={id} />}
        />
    );
}

// ─── Melee ───────────────────────────────────────────────────────────────────

const MELEE_GROUPS: readonly Option[] = [
    { value: "primary", label: "Primary" },
    { value: "primary (shield)", label: "Primary (Shield)" },
    { value: "chain", label: "Chain" },
    { value: "shock", label: "Shock" },
    { value: "power", label: "Power" },
    { value: "exotic", label: "Exotic" },
    { value: "mechadendrite", label: "Mechadendrite" },
];

const SHIELD_SUBTYPES: readonly Option[] = [
    { value: "buckler", label: "Buckler" },
    { value: "targ", label: "Targ" },
    { value: "ecu", label: "Ecu" },
    { value: "round", label: "Round" },
    { value: "teardrop", label: "Teardrop" },
    { value: "light tower", label: "Light Tower" },
    { value: "tower", label: "Tower" },
];

const ARMS: readonly Option[] = [{ value: "left", label: "Left" }, { value: "right", label: "Right" }];

const PROFILES: readonly Option[] = [
    ...["mace", "glaive", "flail", "whip", "claws", "claws.h", "claws.a", "spear", "hook", "fist", "fist.a", "sword",
        "rapier", "saber", "hammer", "axe", "knife", "staff", "bayonet", "shield", "bite", "no"]
        .map(value => ({ value, label: value.replace(/(^|\.)([a-z])/g, (_, dot: string, c: string) => dot + c.toUpperCase()) })),
    { value: "", label: "Other" },
];

const MELEE_BASE_SELECT: readonly Option[] = ["WS", "I", "P", "W", "F"];

const MELEE_BASE: readonly ColumnOption[] = [
    ["standard", "standard", "Standard"], ["charge", "charge", "Charge"], ["full", "full", "Full"],
    ["careful", "careful", "Careful"], ["mounted", "mounted", "Mounted"], ["free", "free", "Free"],
];

const STANCE: readonly ColumnOption[] = [["standard", "standard", "Standard"], ["aggressive", "aggressive", "Aggressive"], ["defensive", "defensive", "Defensive"]];

const MELEE_ROF: readonly ColumnOption[] = [["single", "single", "Single"], ["quick", "quick", "Quick"], ["lightning", "lightning", "Lightning"]];

const MELEE_NAMES = {
    ...AIM_TARGET_NAMES,
    base: { default: "standard", names: { full: "full attack" } },
    stance: { default: "standard", names: {} },
    rof: { default: "single", names: { single: "single attack", quick: "quick attack", lightning: "lightning attack" } },
};

/** A new melee attack: one Mace profile tab and the default roll. */
export function newMeleeAttack() {
    const tabId = `tab-${nanoid()}`;
    return {
        ...newMeleeAttackBase(),
        tabs: { items: { [tabId]: { profile: "mace" } }, layouts: { [tabId]: { colIndex: 0, rowIndex: 0 } } },
    };
}

/** What an autocompleted melee attack starts from; the collection entry brings its tabs. */
const newMeleeAttackBase = () => withRollDefaults(newItemOf(meleeAttack), readSheetState().rollDefaults.meleeAttack);

function MeleeRoll({ path, open, close }: { path: string; open: boolean; close: () => void }) {
    const rollPath = `${path}.roll`;
    const roll = () => {
        const name = String(peekAt(`${path}.name`) || "Unknown");
        rollTotal(rollPath, rollLabel(name, [...selectedNames(rollPath, MELEE_NAMES), ...extraNames(rollPath)]));
        close();
    };
    return (
        <Scope dataId="roll" class={open ? "roll-dropdown melee visible" : "roll-dropdown melee"}>
            <RadioColumn dataId="aim" label="Aim" options={AIM} />
            <RadioColumn dataId="target" label="Target" options={TARGET} />
            <RadioColumn dataId="base" label="Base" options={MELEE_BASE} />
            <RadioColumn dataId="stance" label="Stance" options={STANCE} />
            <RadioColumn dataId="rof" label="RoF" options={MELEE_ROF} />
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult onRoll={roll}><BaseSelect options={MELEE_BASE_SELECT} /></RollResult>
        </Scope>
    );
}

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
                    <Select field="arm" options={ARMS} />
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
                        renderOption={nameAndTypeOption} base={newMeleeAttackBase} />
                </div>
                <ToggleButton onToggle={toggle} />
                <div class="layout-row group">
                    <label>Group:</label>
                    <Select field="group" options={MELEE_GROUPS} />
                    <DragHandle />
                    <DeleteButton itemPath={path} />
                </div>
                {hasRoll && <MeleeRoll path={path} open={dropdown.open} close={dropdown.close} />}
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
                renderLabel={() => <Select field="profile" options={PROFILES} />}
                renderPanel={tabId => <ProfilePanel attackPath={path} tabId={tabId} />}
            />
            <div class="collapsible-content">
                <TextArea field="description" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

export function MeleeAttacks() {
    return (
        <ItemGrid
            dataId="meleeAttacks.list.items"
            id="melee-attack"
            columns={1}
            itemClass="melee-attack"
            newItem={newMeleeAttack}
            renderItem={id => <MeleeAttack itemId={id} />}
        />
    );
}
