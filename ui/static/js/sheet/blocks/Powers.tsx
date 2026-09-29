// Psykana and Techno Arcana: tabs of powers. Powers move between the tabs
// of a block by dragging; resting on a tab label opens that tab.
import { useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import { untracked } from "@preact/signals-core";
import { ToggleButton, useCollapsible } from "../components/Collapsible";
import { useDropdown } from "../components/Dropdown";
import { joinPath, usePath, useSheet } from "../components/context";
import { Checkbox, NumberField, ReadonlyField, Select, TextArea, TextField, hasText } from "../components/fields";
import { peekAt, valueAt } from "../state/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { Tabs } from "../components/Tabs";
import { AutocompleteField } from "../components/AutocompleteField";
import { DAMAGE_TYPES, PSYKANA_TYPES } from "../schema/constants";
import { newItemOf } from "../schema/newItem";
import { psychicPower, techPower } from "../schema/sheet";
import type { RollDefaults } from "../current";
import { bonusSuccessesOf } from "../rollEvents";
import { COMPENSATION, activateTechPower, castPower, compensate } from "../state/cast";
import { hardwareAt } from "../state/hardware";
import { compensationDue, isCompiledFor, techTraitsAt, technoRule } from "../state/tech";
import { rollBonusSuccesses } from "../state/rollBase";
import { firstTestOption, powerTest, powerTestOptions, type TestBlock } from "../state/testOptions";
import { castCap, powerTraitsAt, psykanaRule, safePR, sustainedPowers } from "../state/psychic";
import { PhenomenaRoll } from "./Phenomena";
import { PriceColumn, ProcessList, ProcessPill, TechTraitsToggle, TestBonusColumn, hasCognitionFor } from "./Processes";
import { SustainColumn, SustainFields, SustainPill, SustainedList, useSustainChoice } from "./Sustain";
import { powerPR } from "../state/damage";
import { ModdedField, POWER_FIELD, TECH_FIELD } from "./ModdedField";
import { PsykanaHeading, TechnoArcanaHeading } from "./PsykanaHeading";
import { CurrentResource, ResourceField } from "./ResourceField";
import { Row } from "./Attacks";
import {
    DamageLabel, ExtraModifier, RollResult, RollToggleLabel, compensationTotal, extraNames, psychicTotal,
    rollLabel, rollTotal, techTotal,
} from "./rollParts";
import { TestOptions } from "./TestOptions";

type Kind = "psychic" | "tech";

const newTab = () => ({ name: "New Tab" });

const newPsychicPower = (rolls: RollDefaults) =>
    ({ ...newItemOf(psychicPower), roll: { ...rolls.psychicPower, testOption: firstTestOption("psykana") } });
const newTechPower = (rolls: RollDefaults) =>
    ({ ...newItemOf(techPower), roll: { ...rolls.techPower, testOption: firstTestOption("technoArcana") } });

/** What the roll at `rollPath` is tested on, from its test option; null when the option is gone. */
function usePowerTest(block: TestBlock, rollPath: string) {
    const { stats } = useSheet();
    return useComputed(() => powerTest(stats, block, String(valueAt(`${rollPath}.testOption`) ?? "")));
}

/** The test of a power, one of the test options of its block, and its modifier. */
function BaseColumn({ label, block }: { label: string; block: TestBlock }) {
    const { stats } = useSheet();
    const current = String(valueAt(joinPath(usePath(), "testOption")) ?? "");
    return (
        <div class="roll-column base">
            <label class="column-label">{label}</label>
            <div class="roll-column-content">
                <Select field="testOption" options={powerTestOptions(stats, block, current)} />
                <label class="modifier-label">Modifier:</label>
                <NumberField field="modifier" />
            </div>
        </div>
    );
}

const int = (path: string) => parseInt(String(peekAt(path)), 10) || 0;

/**
 * The effective PR of a psychic power's cast. Max casts it normally at the
 * current PR, Safe at half of it without a kick; bonuses are typed in.
 */
function EffectivePrColumn({ path, safe }: { path: string; safe: boolean }) {
    const { actions } = useSheet();
    const rollPath = `${path}.roll`;
    const cap = useComputed(() => castCap(path)).value;
    const of = valueAt(`${path}.ignoreTprPenalty`) ? "the base PR (talent)" : "the current PR";
    return (
        <div class="roll-column pr-column">
            <label class="column-label">Effective PR</label>
            <div class="roll-column-content">
                <NumberField field="effectivePR" />
                <div class="pr-buttons">
                    <button type="button" data-id="safePR" class={safe ? "pr-button active" : "pr-button"}
                        title={`Safe: ePR ${safePR(cap)}, half ${of} rounded up; no kick, no phenomena`}
                        onClick={() => actions.batch(rollPath, safe ? { safe: false } : { safe: true, effectivePR: safePR(cap), kickPR: 0 })}>
                        Safe
                    </button>
                    <button type="button" data-id="maxPR" class="pr-button" title={`Normal: ePR ${cap}, ${of}`}
                        onClick={() => actions.batch(rollPath, { safe: false, effectivePR: cap })}>
                        Max
                    </button>
                </div>
                {cap <= 0 && <span class="pr-warning" data-id="noPR">No PR left for a new power</span>}
            </div>
        </div>
    );
}

function KickColumn({ rollPath, safe }: { rollPath: string; safe: boolean }) {
    const { actions } = useSheet();
    const set = (value: number) => actions.change(`${rollPath}.kickPR`, value);
    return (
        <div class="roll-column pr-column" title={safe ? "A safe cast has no kick" : undefined}>
            <label class="column-label">Kick</label>
            <div class="roll-column-content">
                <NumberField field="kickPR" readOnly={safe} />
                <div class="pr-buttons">
                    <button type="button" data-id="kickZero" class="pr-button" disabled={safe} onClick={() => set(0)}>0</button>
                    <button type="button" data-id="kickMax" class="pr-button" disabled={safe}
                        onClick={() => set(int("psykana.maxPush"))}>Max</button>
                </div>
            </div>
        </div>
    );
}

function PsychicRoll({ path, close }: { path: string; close: () => void }) {
    const { actions } = useSheet();
    const rollPath = `${path}.roll`;
    const test = usePowerTest("psykana", rollPath);
    const total = useComputed(() => psychicTotal(rollPath, test.value ?? ""));
    const safe = !!valueAt(`${rollPath}.safe`);
    // A cast without PR is none: its damage would count the PR of a normal cast.
    const noPR = (Number(valueAt(`${rollPath}.effectivePR`)) || 0) <= 0;
    const choice = useSustainChoice(path);
    // What this cast does to the sustaining, chosen for it alone.
    const sustain = useSignal(true);
    const free = useSignal(true);
    const roll = () => {
        const name = String(peekAt(`${path}.name`) || "Unknown Power");
        const effectivePR = int(`${rollPath}.effectivePR`);
        const kickPR = safe ? 0 : int(`${rollPath}.kickPR`);
        const modifiers = [
            ...(safe ? ["safe"] : []),
            ...(effectivePR > 0 ? [`${effectivePR} ePR`] : []),
            ...(kickPR > 0 ? [`+${kickPR} kick`] : []),
            ...extraNames(rollPath),
        ];
        void castPower(actions, path, {
            effectivePR, kick: kickPR, safe,
            target: total.peek(), bonusSuccesses: rollBonusSuccesses(test.peek()), label: rollLabel(name, modifiers),
            sustain: choice && !choice.full && sustain.peek() ? { free: choice.canBeFree && free.peek() } : null,
        });
        close();
    };
    return (
        <Scope dataId="roll" class="roll-dropdown visible">
            <BaseColumn label="Psychotest" block="psykana" />
            <EffectivePrColumn path={path} safe={safe} />
            <KickColumn rollPath={rollPath} safe={safe} />
            {choice && <SustainColumn choice={choice} sustain={sustain} free={free} />}
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            <RollResult total={total} onRoll={roll} disabled={test.value === null || noPR}
                title={noPR ? "Set the effective PR, e.g. with Max or Safe" : undefined} />
        </Scope>
    );
}

/** The ⚙ of a psychic power: what its subtypes and Sustained field make of it, and its talent. */
function PowerTraits({ path }: { path: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const dropdown = useDropdown(ref);
    return (
        <span class="power-traits dropdown-parent" ref={ref}>
            <button type="button" class={dropdown.open ? "power-traits-toggle active" : "power-traits-toggle"}
                title="Traits and talents of the power" onClick={dropdown.toggle}>⚙</button>
            {dropdown.open && <PowerTraitsDropdown path={path} />}
        </span>
    );
}

function PowerTraitsDropdown({ path }: { path: string }) {
    const traits = useComputed(() => powerTraitsAt(path)).value;
    const phenomenaShown = useComputed(() => psykanaRule("phenomena")).value;
    const x = (n: number | null | undefined, unknown: string) => (n === null || n === undefined ? unknown : String(n));
    return (
        <div class="roll-dropdown power-traits-dropdown visible">
            <span class="column-label">From Subtypes and Sustained</span>
            <ul class="power-traits-list" data-id="traits">
                <li>{traits.sustainable ? "Can be sustained" : "Cannot be sustained"}</li>
                {traits.cycle !== undefined && (
                    <li>{`Cycle (${x(traits.cycle, "?")}): sustaining it may be free when cast at ePR ${x(traits.cycle, "X")} or more`}</li>
                )}
                {traits.repeatable !== undefined && (
                    <li>{`Repeatable (${x(traits.repeatable, "?")}): ${x(traits.repeatable, "X")} of its casts are sustained at once, those after them are not`}</li>
                )}
            </ul>
            <SustainFields path={path} />
            {phenomenaShown && (
                <label class="power-traits-phenomena" title="What the power adds to the phenomena of its casts">
                    Phenomena mod <NumberField field="phenomenaMod" class="short" />
                </label>
            )}
            <label class="power-traits-talent" title="Its casts count from the base PR rather than the current one">
                <Checkbox field="ignoreTprPenalty" class="custom" />
                <span>Talent: ignores the PR the sustained powers take</span>
            </label>
        </div>
    );
}

function TechRoll({ path, close }: { path: string; close: () => void }) {
    const { actions, canEdit } = useSheet();
    const rollPath = `${path}.roll`;
    const test = usePowerTest("technoArcana", rollPath);
    const hardware = useComputed(() => (technoRule("hardware") ? hardwareAt(path) : null));
    const total = useComputed(() => techTotal(rollPath, test.value ?? "") + (hardware.value?.mod ?? 0));
    const traits = useComputed(() => techTraitsAt(path)).value;
    // Whether this activation holds the power in a Process and how much 🗲 it pays with Fatigue, chosen for it alone.
    const process = useSignal(true);
    const asFatigue = useSignal(0);
    // A viewer's roll spends nothing, so lacking the ⚙ or a compilation does not stop it.
    const noCognition = canEdit && !hasCognitionFor(traits);
    const notCompiled = canEdit && !isCompiledFor(path, traits);
    const stop = noCognition ? "Not enough ⚙ to activate it" : notCompiled ? "Compile the Litany first" : null;
    const roll = () => {
        const x = int(`${rollPath}.x`);
        const worst = hardware.peek()?.worst;
        const label = rollLabel(String(peekAt(`${path}.name`) || "Unknown Power"), [
            ...(traits.price.x ? [`X = ${x}`] : []),
            ...(worst ? [`${worst.quality}.Q`] : []),
            ...extraNames(rollPath),
        ]);
        const versus = traits.auto ? null : { target: total.peek(), bonusSuccesses: rollBonusSuccesses(test.peek()), label };
        void activateTechPower(actions, path, {
            x, process: !!traits.process && process.peek(), test: versus, energyAsFatigue: asFatigue.peek(),
        });
        close();
    };
    return (
        <Scope dataId="roll" class="roll-dropdown power-roll tech-roll visible">
            <BaseColumn label="Test" block="technoArcana" />
            <PriceColumn path={path} traits={traits} process={process} asFatigue={asFatigue} />
            <TestBonusColumn hardware={hardware.value} />
            <ExtraModifier n={1} />
            <ExtraModifier n={2} />
            {traits.auto ? (
                <RollResult total={total} onRoll={roll} button="Activate" disabled={!canEdit || stop !== null}
                    title={stop ?? "Tested automatically: activates without a roll"} />
            ) : (
                <RollResult total={total} onRoll={roll} disabled={test.value === null || stop !== null} title={stop ?? undefined} />
            )}
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
    const hasRoll = valueAt(`${path}.roll.testOption`) !== undefined;
    const Roll = kind === "psychic" ? PsychicRoll : TechRoll;
    const field = kind === "psychic" ? POWER_FIELD : TECH_FIELD;
    const damageLabel = () => {
        const name = String(peekAt(`${path}.name`) || (kind === "psychic" ? "Psychic Power" : "Tech Power"));
        return kind === "psychic" ? `${name}, PR ${untracked(() => powerPR(path))}` : name;
    };

    return (
        <Scope dataId={itemId} class={collapsed ? `${itemClass} item-with-description collapsed` : `${itemClass} item-with-description`} elRef={elRef}>
            <div class="split-header dropdown-parent">
                <div class="layout-row name">
                    <RollToggleLabel open={dropdown.open} onToggle={dropdown.toggle} />
                    <span class="name-field">
                        <AutocompleteField field="name" itemPath={path}
                            collection={kind === "psychic" ? "psychicPowers" : "techPowers"}
                            base={newPower} />
                        {kind === "psychic" ? <PowerTraits path={path} /> : <TechTraitsToggle path={path} />}
                    </span>
                </div>
                {kind === "psychic" ? <SustainPill path={path} /> : <ProcessPill path={path} />}
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
                {/* Rendered only while open: its test select reads the names of the skills
                    it offers, and a sheet has many powers. */}
                {hasRoll && dropdown.open && <Roll path={path} close={dropdown.close} />}
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
                    <Row cls="damage" label={<DamageLabel owner={field.damage} itemPath={path} label={damageLabel} />}>
                        <ModdedField stat="damage" owner={field} />
                    </Row>
                    <Row cls="pen" label="Pen:"><ModdedField stat="pen" owner={field} /></Row>
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

/** Sustained Powers: counted from the marked powers, or typed while the sheet does not count them. */
function SustainedPowersField() {
    const counting = useComputed(() => psykanaRule("sustained")).value;
    const counted = useComputed(() => sustainedPowers().taken);
    if (!counting) return <label>Sustained Powers: <NumberField field="sustainedPowers" class="short" /></label>;
    return (
        <label title="Counted from the powers marked sustained; turn the counting off under ⚙ to type it">Sustained Powers:
            <ReadonlyField field="sustainedCount" value={counted} type="number" class="short textlike" />
        </label>
    );
}

export function Psykana() {
    return (
        <>
            <PsykanaHeading />
            <Scope dataId="psykana" class="layout-column">
                <div id="pr-bar" class="layout-column centered-bar">
                    <div class="layout-row">
                        <label>Psykana type:
                            <Select field="psykanaType" options={PSYKANA_TYPES} />
                        </label>
                        <label>Max Push:
                            <NumberField field="maxPush" class="short" />
                        </label>
                        <TestOptions />
                        <PhenomenaRoll />
                    </div>
                    <div class="layout-row">
                        <label>Base PR:
                            <NumberField field="basePR" class="short" />
                        </label>
                        <SustainedPowersField />
                        <label>Current PR:
                            <ReadonlyField field="effectivePR" type="number" class="short textlike" />
                        </label>
                    </div>
                    <SustainedList />
                </div>
                <PowerTabs kind="psychic" />
            </Scope>
        </>
    );
}

/**
 * The Compensation Roll. After a Compensator power paid its 🗲, it stands out
 * and says what was paid; its roll then gives back one for each Success. The
 * player decides: letting it go keeps the price as paid.
 */
function CompensationRoll() {
    const { actions, canEdit } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const rollPath = "technoArcana.compensationRoll";
    const total = useComputed(() => compensationTotal(rollPath));
    const due = useComputed(compensationDue).value;
    const roll = () => {
        const modifier = parseInt(String(peekAt(`${rollPath}.modifier`)), 10) || 0;
        const label = rollLabel(due ? `Compensator, ${due.name}` : "Compensator", [`X = ${modifier}`, ...extraNames(rollPath)]);
        const outcome = rollTotal(rollPath, total.peek(), label, bonusSuccessesOf("T"));
        const power = String(peekAt(`${COMPENSATION}.power`) ?? "");
        if (due) void outcome.then(o => { if (o) compensate(actions, o.success ? o.degrees : 0, power); });
        dropdown.close();
    };
    const paid = due && [due.energy > 0 ? `${due.energy} 🗲` : "", due.fatigue > 0 ? `${due.fatigue} Fatigue` : ""].filter(Boolean).join(" and ");
    return (
        <Scope dataId="compensationRoll" class="dropdown-parent" elRef={ref}>
            <button type="button" class={`compensation-toggle button-colored${due ? " attention" : ""}${dropdown.open ? " active" : ""}`}
                title={due ? `${due.name} paid ${paid}: a compensation roll gives one back for each Success` : undefined}
                onClick={dropdown.toggle}>Compensation Roll</button>
            <div class={dropdown.open ? "roll-dropdown roll-dropdown-centered roll-dropdown-stacked compensation-dropdown visible" : "roll-dropdown roll-dropdown-centered roll-dropdown-stacked compensation-dropdown"}>
                <span class="roll-dropdown-description">Roll formula: T - (10 × X) + extras</span>
                {due && (
                    <div class="compensation-due" data-id="compensationDue">
                        <span>{`${due.name}, Compensator (${due.x}), paid ${paid}`}</span>
                        {canEdit && (
                            <button type="button" class="compensation-let-go" data-id="letGo" title="Keep the price as paid"
                                onClick={() => compensate(actions, 0, String(peekAt(`${COMPENSATION}.power`) ?? ""))}>Let it go</button>
                        )}
                    </div>
                )}
                <div class="roll-columns-row">
                    <div class="roll-column base">
                        <label class="column-label">X:</label>
                        <div class="roll-column-content">
                            <NumberField field="modifier" class="short" />
                        </div>
                    </div>
                    <ExtraModifier n={1} />
                    <ExtraModifier n={2} />
                    <RollResult total={total} onRoll={roll} />
                </div>
            </div>
        </Scope>
    );
}

export function TechnoArcana() {
    return (
        <>
            <TechnoArcanaHeading />
            <Scope dataId="technoArcana" class="layout-column">
                <div id="techno-arcana-bar" class="layout-column centered-bar">
                    <div class="layout-row">
                        <label>Current Cognition:
                            <CurrentResource field="currentCognition" max="cognitionMax" />
                        </label>
                        {/* Not labels: a click in their dropdowns would go to the total. */}
                        <span class="resource-stat">Max Cognition: <ResourceField stat="cognitionMax" /></span>
                        <span class="resource-stat">Restore per turn: <ResourceField stat="cognitionRestore" /></span>
                        <TestOptions />
                    </div>
                    <div class="layout-row">
                        <label>Current Energy:
                            <CurrentResource field="currentEnergy" max="energyMax" />
                        </label>
                        <span class="resource-stat">Max Energy: <ResourceField stat="energyMax" /></span>
                        <span class="resource-stat">Restore per turn: <ResourceField stat="energyRestore" /></span>
                        <CompensationRoll />
                    </div>
                    <ProcessList />
                </div>
                <PowerTabs kind="tech" />
            </Scope>
        </>
    );
}
