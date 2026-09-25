// Psykana and Techno Arcana: tabs of powers. Powers move between the tabs
// of a block by dragging; resting on a tab label opens that tab.
import { useRef } from "preact/hooks";
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { useDropdown } from "../components/Dropdown";
import { joinPath, usePath, useSheet } from "../components/context";
import { NumberField, ReadonlyField, Select, TextArea, TextField, hasText, peekAt, valueAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { Tabs } from "../components/Tabs";
import { AutocompleteField } from "../components/useAutocomplete";
import { DAMAGE_TYPES, PSYCHIC_BASE_SELECTS, PSYKANA_TYPES, TECH_BASE_SELECTS, type Option } from "../schema/constants";
import { newItemOf } from "../schema/newItem";
import { psychicPower, techPower } from "../schema/sheet";
import type { RollDefaults } from "../current";
import { bonusSuccessesOf } from "../rollEvents";
import { Row } from "./Attacks";
import {
    BaseSelect, DamageLabel, ExtraModifier, RollResult, RollToggleLabel, extraNames, rollLabel, rollTotal,
} from "./rollParts";

type Kind = "psychic" | "tech";

const newTab = () => ({ name: "New Tab" });

const newPsychicPower = (rolls: RollDefaults) => ({ ...newItemOf(psychicPower), roll: rolls.psychicPower });
const newTechPower = (rolls: RollDefaults) => ({ ...newItemOf(techPower), roll: rolls.techPower });

function BaseColumn({ label, options }: { label: string; options: readonly Option[] }) {
    return (
        <div class="roll-column base">
            <label class="column-label">{label}</label>
            <div class="roll-column-content">
                <BaseSelect options={options} />
                <label class="modifier-label">Modifier:</label>
                <NumberField field="modifier" />
            </div>
        </div>
    );
}

/** A PR column: the value and buttons that set it to 0 or to its maximum. */
function PrColumn({ label, field, zeroId, maxId, max, rollPath }: {
    label: string; field: string; zeroId: string; maxId: string; max: () => number; rollPath: string;
}) {
    const { actions } = useSheet();
    const set = (value: number) => actions.change(`${rollPath}.${field}`, value);
    return (
        <div class="roll-column pr-column">
            <label class="column-label">{label}</label>
            <div class="roll-column-content">
                <NumberField field={field} />
                <div class="pr-buttons">
                    <button type="button" data-id={zeroId} class="pr-button" onClick={() => set(0)}>0</button>
                    <button type="button" data-id={maxId} class="pr-button" onClick={() => set(max())}>Max</button>
                </div>
            </div>
        </div>
    );
}

function PsychicRoll({ path, open, close }: { path: string; open: boolean; close: () => void }) {
    const rollPath = `${path}.roll`;
    const roll = () => {
        const name = String(peekAt(`${path}.name`) || "Unknown Power");
        const effectivePR = parseInt(String(peekAt(`${rollPath}.effectivePR`)), 10) || 0;
        const kickPR = parseInt(String(peekAt(`${rollPath}.kickPR`)), 10) || 0;
        const modifiers = [
            ...(effectivePR > 0 ? [`${effectivePR} ePR`] : []),
            ...(kickPR > 0 ? [`+${kickPR} kick`] : []),
            ...extraNames(rollPath),
        ];
        rollTotal(rollPath, rollLabel(name, modifiers));
        close();
    };
    const psykana = (field: string) => parseInt(String(peekAt(`psykana.${field}`)), 10) || 0;
    return (
        <Scope dataId="roll" class={open ? "roll-dropdown visible" : "roll-dropdown"}>
            <BaseColumn label="Psychotest" options={PSYCHIC_BASE_SELECTS} />
            <PrColumn label="Effective PR" field="effectivePR" zeroId="zeroPR" maxId="maxPR" max={() => psykana("effectivePR")} rollPath={rollPath} />
            <PrColumn label="Kick" field="kickPR" zeroId="kickZero" maxId="kickMax" max={() => psykana("maxPush")} rollPath={rollPath} />
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult onRoll={roll} />
        </Scope>
    );
}

function TechRoll({ path, open, close }: { path: string; open: boolean; close: () => void }) {
    const rollPath = `${path}.roll`;
    const roll = () => {
        rollTotal(rollPath, rollLabel(String(peekAt(`${path}.name`) || "Unknown Power"), extraNames(rollPath)));
        close();
    };
    return (
        <Scope dataId="roll" class={open ? "roll-dropdown visible" : "roll-dropdown"}>
            <BaseColumn label="Test" options={TECH_BASE_SELECTS} />
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult onRoll={roll} />
        </Scope>
    );
}

function Power({ kind, itemId, itemClass, newPower }: { kind: Kind; itemId: string; itemClass: string; newPower: () => object }) {
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        // A power always has something to show, as its damage type is always set.
        hasContent: () => true,
        startsCollapsed: () => !hasText(`${path}.action`) && !hasText(`${path}.effect`),
    });
    // The roll dropdown closes on a click outside the power.
    const dropdown = useDropdown(elRef);
    const hasRoll = valueAt(`${path}.roll.baseSelect`) !== undefined;
    const Roll = kind === "psychic" ? PsychicRoll : TechRoll;
    const damageFallback = kind === "psychic" ? "Psychic Power" : "Tech Power";

    return (
        <Scope dataId={itemId} class={collapsed ? `${itemClass} item-with-description collapsed` : `${itemClass} item-with-description`} elRef={elRef}>
            <div class="split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <AutocompleteField field="name" itemPath={path}
                        collection={kind === "psychic" ? "psychicPowers" : "techPowers"}
                        base={newPower} />
                </div>
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
                {hasRoll && <Roll path={path} open={dropdown.open} close={dropdown.close} />}
            </div>
            <div class="collapsible-content">
                <div class="layout-row">
                    <Row cls="subtypes" label="Subtypes:"><TextField field="subtypes" /></Row>
                    <Row cls="range" label="Range:"><TextField field="range" /></Row>
                </div>
                {kind === "psychic" ? (
                    <div class="layout-row">
                        <Row cls="psychotest" label="Test:"><TextField field="psychotest" /></Row>
                        <Row cls="action" label="Action:"><TextField field="action" /></Row>
                        <Row cls="sustained" label="Sustained:"><TextField field="sustained" /></Row>
                    </div>
                ) : (
                    <>
                        <div class="layout-row">
                            <Row cls="implants" label="Implants:"><TextField field="implants" /></Row>
                            <Row cls="price" label="Price:"><TextField field="price" /></Row>
                            <Row cls="process" label="Process:"><TextField field="process" /></Row>
                        </div>
                        <div class="layout-row">
                            <Row cls="test" label="Test:"><TextField field="test" /></Row>
                            <Row cls="action" label="Action:"><TextField field="action" /></Row>
                        </div>
                    </>
                )}
                <div class="layout-row">
                    <Row cls="weapon-range" label="Range:"><TextField field="weaponRange" /></Row>
                    <Row cls="damage" label={<DamageLabel damagePath={`${path}.damage`} label={() => String(peekAt(`${path}.name`) || damageFallback)} />}>
                        <TextField field="damage" />
                    </Row>
                    <Row cls="pen" label="Pen:"><TextField field="pen" /></Row>
                    <Row cls="type" label="Type:"><Select field="damageType" options={DAMAGE_TYPES} /></Row>
                </div>
                <div class="layout-row">
                    <Row cls="rof" label="RoF:">
                        <TextField field="rofSingle" />/
                        <TextField field="rofShort" class="shorter-input" />/
                        <TextField field="rofLong" class="shorter-input" />
                    </Row>
                    <Row cls="special" label="Special:"><TextField field="special" /></Row>
                </div>
                <TextArea field="effect" class="split-description" placeholder=" " />
            </div>
        </Scope>
    );
}

/** Tabs of powers; a power can be dragged into another tab's grid. */
function PowerTabs({ kind }: { kind: Kind }) {
    const prefix = kind === "psychic" ? "psychic-powers" : "tech-powers";
    const itemClass = kind === "psychic" ? "psychic-power" : "tech-power";
    const { rollDefaults } = useSheet();
    const newPower = () => (kind === "psychic" ? newPsychicPower : newTechPower)(rollDefaults);
    // A power's drag freezes all tabs of the block: it can land in any of them.
    const tabsPath = joinPath(usePath(), "tabs.items");
    return (
        <Tabs
            dataId="tabs.items"
            group={kind === "psychic" ? "psykana-tabs" : "techno-tabs"}
            class="power-tabs"
            newItem={newTab}
            renderLabel={() => <TextField field="name" />}
            renderPanel={tabId => (
                <ItemGrid
                    dataId="powers.items"
                    id={`${prefix}-${tabId}`}
                    itemClass={itemClass}
                    newItem={newPower}
                    shared={{ group: `${prefix}-shared`, freezePath: tabsPath }}
                    renderItem={id => <Power kind={kind} itemId={id} itemClass={itemClass} newPower={newPower} />}
                />
            )}
        />
    );
}

export function Psykana() {
    return (
        <Scope dataId="psykana" class="layout-column">
            <div id="pr-bar" class="layout-column centered-bar">
                <div class="layout-row">
                    <label>Psykana type:
                        <Select field="psykanaType" options={PSYKANA_TYPES} />
                    </label>
                    <label>Max Push:
                        <NumberField field="maxPush" class="short" />
                    </label>
                </div>
                <div class="layout-row">
                    <label>Base PR:
                        <NumberField field="basePR" class="short" />
                    </label>
                    <label>Sustained Powers:
                        <NumberField field="sustainedPowers" class="short" />
                    </label>
                    <label>Effective PR:
                        <ReadonlyField field="effectivePR" type="number" class="short textlike" />
                    </label>
                </div>
            </div>
            <PowerTabs kind="psychic" />
        </Scope>
    );
}

function CompensationRoll() {
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const rollPath = "technoArcana.compensationRoll";
    const roll = () => {
        const modifier = parseInt(String(peekAt(`${rollPath}.modifier`)), 10) || 0;
        rollTotal(rollPath, rollLabel("Compensator", [`X = ${modifier}`, ...extraNames(rollPath)]), bonusSuccessesOf("T"));
        dropdown.close();
    };
    return (
        <Scope dataId="compensationRoll" class="dropdown-parent" elRef={ref}>
            <button type="button" class={dropdown.open ? "compensation-toggle button-colored active" : "compensation-toggle button-colored"}
                onClick={dropdown.toggle}>Compensation Roll</button>
            <div class={dropdown.open ? "roll-dropdown roll-dropdown-centered roll-dropdown-stacked visible" : "roll-dropdown roll-dropdown-centered roll-dropdown-stacked"}>
                <span class="roll-dropdown-description">Roll formula: T - (10 × X) + extras</span>
                <div class="roll-columns-row">
                    <div class="roll-column base">
                        <label class="column-label">X:</label>
                        <div class="roll-column-content">
                            <NumberField field="modifier" class="short" />
                        </div>
                    </div>
                    <ExtraModifier n={1} />
                    <ExtraModifier n={2} />
                    <RollResult onRoll={roll} />
                </div>
            </div>
        </Scope>
    );
}

export function TechnoArcana() {
    return (
        <Scope dataId="technoArcana" class="layout-column">
            <div id="techno-arcana-bar" class="layout-column centered-bar">
                <div class="layout-row">
                    <label>Current Cognition:
                        <NumberField field="currentCognition" class="short" />
                    </label>
                    <label>Max Cognition:
                        <NumberField field="maxCognition" class="short" />
                    </label>
                    <label>Restore per turn:
                        <NumberField field="restoreCognition" class="short" />
                    </label>
                </div>
                <div class="layout-row">
                    <label>Current Energy:
                        <NumberField field="currentEnergy" class="short" />
                    </label>
                    <label>Max Energy:
                        <NumberField field="maxEnergy" class="short" />
                    </label>
                    <CompensationRoll />
                </div>
            </div>
            <PowerTabs kind="tech" />
        </Scope>
    );
}
