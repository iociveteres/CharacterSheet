// The tabs of powers that Psykana (magic/) and Techno Arcana (tech/) share,
// and the card of a power in them; what a sort of power has of its own comes
// in its PowerSort. Powers move between the tabs of a block by dragging;
// resting on a tab label opens that tab.
import type { ComponentType } from "preact";
import { ToggleField, useCollapsible } from "../components/Collapsible";
import { useDropdown } from "../components/Dropdown";
import { joinPath, usePath, useSheet } from "../components/context";
import type { AutocompleteResult } from "../components/context";
import { NumberField, Select, TextArea, TextField, hasText, Row } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { Tabs } from "../components/Tabs";
import { AutocompleteField } from "../components/AutocompleteField";
import type { SheetSignals } from "../schema/sheet";
import type { PsykanaTerms } from "../schema/constants";
import type { SheetOps } from "../core/actions";
import type { RollDefaults } from "../payload";
import { valueAt } from "../core/sync";
import { newItemAt } from "../core/fromJson";
import { schemaOf } from "../core/state";
import type { CastOn, TestBlock } from "../rolls/testOptionRules";
import { ModdedField, type FieldOwner } from "../rolls/ModdedField";
import { DamageLabel, RollToggleLabel, TestSelect } from "../rolls/rollParts";

const newTab = () => ({ name: "New Tab" });

/** The test of a power, one of the test options of its block, and its modifier; a spell reads Cast as `cast`. */
export function BaseColumn({ label, block, cast }: { label: string; block: TestBlock; cast?: CastOn }) {
    return (
        <div class="roll-column base">
            <label class="column-label">{label}</label>
            <div class="roll-column-content">
                <TestSelect block={block} cast={cast} />
                <label class="modifier-label">Modifier:</label>
                <NumberField field="modifier" />
            </div>
        </div>
    );
}

export type NewPower = { roll: object };
type AtPath = ComponentType<{ path: string }>;

/**
 * What the card and the tabs of a sort of power have of their own: psychic
 * powers in Psykana, tech powers in Techno Arcana. Each part takes the path
 * of the power.
 */
export interface PowerSort {
    /** The roll dropdown, rendered while open. */
    Roll: ComponentType<{ path: string; close: () => void }>;
    /** Before the Name label, as the bookmark of a spell to prepare. */
    Lead?: AtPath;
    /** The ⚙ after the name. */
    Traits: AtPath;
    /** The marks after the name, as Sustain or Process. */
    Pill: AtPath;
    /** The rows of its fields above its damage. */
    Fields: AtPath;
    /** Its damage and penetration. */
    field: FieldOwner;
    /** The label of a roll of its damage. */
    damageLabel: (state: SheetSignals, path: string, terms: PsykanaTerms) => string;
    /** The autocomplete collection of its name. */
    collection: string;
    /** What a pick of the collection makes of a new power. */
    picked?: (sheet: Pick<SheetOps, "state" | "actions">, result: AutocompleteResult, power: NewPower) => NewPower;
    /** The roll of a new power. */
    newRoll: (state: SheetSignals, defaults: RollDefaults) => object;
    /** Starts the ids of its grids and names the group powers are dragged in. */
    prefix: string;
    itemClass: string;
    /** The group of its tabs. */
    tabGroup: string;
}

function Power({ sort, itemId, newPower }: { sort: PowerSort; itemId: string; newPower: () => NewPower }) {
    const { state, actions, terms, stats } = useSheet();
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        // A power always has something to show, as its damage type is always set.
        hasContent: () => true,
        startsCollapsed: () => !hasText(state, `${path}.action`) && !hasText(state, `${path}.effect`),
    });
    // The roll dropdown closes on a click outside the power.
    const dropdown = useDropdown(elRef);
    const hasRoll = valueAt(state, `${path}.roll.testOption`) !== undefined;
    const { Roll, Lead, Traits, Pill, Fields, field, itemClass } = sort;
    const pickedPower = (result: AutocompleteResult) => (sort.picked ? sort.picked({ state, actions }, result, newPower()) : newPower());

    return (
        <Scope dataId={itemId} class={collapsed ? `${itemClass} item-with-description collapsed` : `${itemClass} item-with-description`} elRef={elRef}>
            <div class="split-header dropdown-parent">
                <div class="layout-row name">
                    {Lead && <Lead path={path} />}
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <span class="name-field">
                        <ToggleField onToggle={toggle}>
                            <AutocompleteField field="name" itemPath={path} collection={sort.collection} base={pickedPower} />
                        </ToggleField>
                        <Traits path={path} />
                    </span>
                </div>
                <Pill path={path} />
                <DragHandle />
                <DeleteButton itemPath={path} />
                {/* Rendered only while open: its test select reads the names of the skills
                    it offers, and a sheet has many powers. */}
                {hasRoll && dropdown.open && <Roll path={path} close={dropdown.close} />}
            </div>
            <div class="collapsible-content">
                <Fields path={path} />
                <div class="layout-row">
                    <Row cls="weapon-range" label="Range:"><TextField field="weaponRange" /></Row>
                    <Row cls="damage" label={<DamageLabel owner={field.damage} itemPath={path} label={() => sort.damageLabel(state, path, terms)} />}>
                        <ModdedField stat="damage" owner={field} />
                    </Row>
                    <Row cls="pen" label="Pen:"><ModdedField stat="pen" owner={field} /></Row>
                    <Row cls="type" label="Type:"><Select field="damageType" options={stats.damageTypes} /></Row>
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
export function PowerTabs({ sort }: { sort: PowerSort }) {
    const { prefix, itemClass } = sort;
    const { state, rollDefaults } = useSheet();
    // A power's drag freezes all tabs of the block: it can land in any of them.
    const tabsPath = joinPath(usePath(), "tabs.items");
    // The item of the kind's schema: a spell of Pathfinder Crusade has fields of its own (withOwnFields).
    const newPower = (tabId: string): NewPower => ({
        ...newItemAt(schemaOf(state), `${tabsPath}.${tabId}.powers.items`),
        roll: sort.newRoll(state, rollDefaults),
    });
    return (
        <Tabs
            dataId="tabs.items"
            group={sort.tabGroup}
            class="power-tabs"
            newItem={newTab}
            renderLabel={() => <TextField field="name" />}
            renderPanel={tabId => (
                <ItemGrid
                    dataId="powers.items"
                    id={`${prefix}-${tabId}`}
                    itemClass={itemClass}
                    newItem={() => newPower(tabId)}
                    shared={{ group: `${prefix}-shared`, freezePath: tabsPath }}
                    renderItem={id => <Power sort={sort} itemId={id} newPower={() => newPower(tabId)} />}
                />
            )}
        />
    );
}
