// Tech powers by the rules (state/tech.ts): the price in a power's roll
// dropdown, its traits under its ⚙, the mark of a power held in Processes
// and the list of them in the Techno Arcana bar.
import type { ComponentChildren } from "preact";
import type { Signal } from "@preact/signals-core";
import { useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { NumberField, ReadonlyField } from "../components/fields";
import { ItemGrid } from "../components/ItemGrid";
import { useItemIds } from "../components/useItemIds";
import type { Hardware } from "../state/hardware";
import { ModRow, signed } from "./ResourceField";
import { Scope } from "../components/Scope";
import { numberAt } from "../state/sync";
import {
    COGNITION, ENERGY, costText, processAfterActivation, processCost, processShortfall, processes, techTraitsAt, technoRule,
    type ProcessHeld, type TechTraits,
} from "../state/tech";
import type { SheetSignals } from "../schema/sheet";

/** Whether the character has the ⚙ an activation of a power with `traits` spends before its test. */
export const hasCognitionFor = (state: SheetSignals, traits: TechTraits) => !technoRule(state, "price") || traits.price.cognition <= numberAt(state, COGNITION);

/** A row of the roll dropdown under its columns, one for each thing an activation does. */
export function RollRow({ label, class: cls, children }: { label: string; class: string; children: ComponentChildren }) {
    return (
        <div class={`roll-column sustain-column ${cls}`}>
            <label class="column-label">{label}</label>
            <div class="roll-column-content">{children}</div>
        </div>
    );
}

/**
 * Rows under the columns of the roll dropdown: the price of an activation
 * with its X and how much of its 🗲 to pay with Fatigue, whether a successful
 * one holds the power in a Process, and the compilations of a Litany. Says
 * what the character lacks: without the ⚙ the power is not rolled, the 🗲
 * short is paid with Fatigue.
 */
export function PriceColumn({ path, traits, process, asFatigue }: {
    path: string; traits: TechTraits; process: Signal<boolean>; asFatigue: Signal<number>;
}) {
    const { state, canEdit, actions } = useSheet();
    const paid = useComputed(() => technoRule(state, "price")).value;
    const counted = useComputed(() => technoRule(state, "processes")).value;
    const held = counted && !!traits.process;
    const litany = counted && traits.litany !== undefined;
    const compiled = numberAt(state, `${path}.compiled`);
    const { price } = traits;
    const cognition = numberAt(state, COGNITION);
    const energy = numberAt(state, ENERGY);
    const fromEnergy = Math.max(0, price.energy - asFatigue.value);
    // The Doctrines this activation would end.
    const names = useComputed(() => {
        const changes = processAfterActivation(state, path, numberAt(state, `${path}.roll.x`));
        return processes(state).powers.filter(p => p.path !== path && changes.has(p.path)).map(p => p.name);
    }).value;
    return (
        <>
            {(paid || price.x) && (
                <RollRow label="Price" class="price-column">
                    {paid && <span class="price-text" data-id="priceText">{costText(price)}</span>}
                    {price.x && <label class="sustain-option" title="The X of the price, and of the Process">X <NumberField field="x" class="short" /></label>}
                    {paid && price.energy > 0 && (
                        <label class="sustain-option price-fatigue" title="🗲 of the price paid with 1 Fatigue each instead">
                            <input type="number" class="short" data-id="energyAsFatigue" min={0} max={price.energy} value={asFatigue.value}
                                onInput={e => { asFatigue.value = Math.min(price.energy, Math.max(0, parseInt(e.currentTarget.value, 10) || 0)); }} />
                            🗲 as Fatigue
                        </label>
                    )}
                    {paid && (price.cognition > cognition || fromEnergy > energy) && (
                        <span class="roll-warnings">
                            {price.cognition > cognition && (
                                <span class="pr-warning" data-id="noCognition">{`${cognition} of ${Math.ceil(price.cognition)} ⚙: not enough to activate`}</span>
                            )}
                            {fromEnergy > energy && (
                                <span class="pr-warning" data-id="noEnergy" title="Each 🗲 short is paid with 1 Fatigue">
                                    {`${energy} of ${fromEnergy} 🗲: the rest as Fatigue`}
                                </span>
                            )}
                        </span>
                    )}
                </RollRow>
            )}
            {held && traits.process && (
                <RollRow label="Process" class="process-row">
                    <label class="sustain-option" title={`Holds it in a Process if the activation succeeds: ${costText(traits.process)} a turn`}>
                        <input type="checkbox" class="custom" data-id="holdInProcess" checked={process.value}
                            onChange={e => { process.value = e.currentTarget.checked; }} />
                        {traits.unique ? "Run, unique" : "Run"}
                    </label>
                    {process.value && names.length > 0 && (
                        <span class="sustain-note" data-id="endsDoctrine">{`Ends ${names.join(", ")}`}</span>
                    )}
                </RollRow>
            )}
            {litany && (
                <RollRow label="Litany" class="litany-row">
                    <span class="sustain-option" data-id="litany"
                        title={`Compiled for ${traits.litany! * 5} minutes, each compilation a Process of ${costText({ cognition: traits.litany! / 2, energy: 0 })} until used`}>
                        {`Compiled ${compiled}`}
                        {canEdit && (
                            <button type="button" class="pr-button" data-id="compile" onClick={() => actions.change(`${path}.compiled`, compiled + 1)}>
                                Compile
                            </button>
                        )}
                    </span>
                    {compiled === 0 && <span class="pr-warning" data-id="notCompiled">Not compiled: compile it first</span>}
                </RollRow>
            )}
        </>
    );
}

/** What the hardware adds to a tech power's test, or the implants it lacks; a row of its own under the price. */
export function TestBonusColumn({ hardware }: { hardware: Hardware | null }) {
    if (!hardware || (!hardware.worst && hardware.missing.length === 0)) return null;
    return (
        <RollRow label="Test" class="test-bonus-column">
            {hardware.worst && (
                <span class="sustain-note" data-id="hardware">
                    {`${hardware.worst.name} ${hardware.worst.quality}.Q ${signed(hardware.mod)}`}
                </span>
            )}
            {hardware.missing.length > 0 && (
                <span class="pr-warning" data-id="noHardware" title="It cannot be used without them; the name may be written otherwise">
                    {`No ${hardware.missing.join(", ")}`}
                </span>
            )}
        </RollRow>
    );
}

/** The ⚙ of a tech power: what its Price, Process, Subtypes and Test make of it, and its Processes to set by hand. */
export function TechTraitsToggle({ path }: { path: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const dropdown = useDropdown(ref);
    return (
        <span class="power-traits dropdown-parent" ref={ref}>
            <button type="button" class={dropdown.open ? "power-traits-toggle active" : "power-traits-toggle"}
                title="Price and Process of the power" onClick={dropdown.toggle}>⚙</button>
            {dropdown.open && <TechTraitsDropdown path={path} />}
        </span>
    );
}

function TechTraitsDropdown({ path }: { path: string }) {
    const { state, canEdit, actions } = useSheet();
    const traits = useComputed(() => techTraitsAt(state, path, numberAt(state, `${path}.inProcess.x`))).value;
    const held = useComputed(() => technoRule(state, "processes")).value;
    const copies = numberAt(state, `${path}.inProcess.copies`);
    return (
        <div class="roll-dropdown power-traits-dropdown visible">
            <span class="column-label">From Price, Process, Subtypes and Test</span>
            <ul class="power-traits-list" data-id="traits">
                <li>{`Price ${costText(traits.price)}${traits.price.x ? " (X of the roll)" : ""}`}</li>
                <li>{traits.process
                    ? `Process ${costText(traits.process)} a turn${traits.unique ? ", unique: held once at most" : ""}`
                    : "No Process"}</li>
                {traits.doctrine && <li>Doctrine: one at a time in the Processes</li>}
                {traits.auto && <li>Tested automatically: activated without a roll</li>}
                {traits.litany !== undefined && (
                    <li>{`Litany (${traits.litany}): used only compiled, each compilation a Process of ${costText({ cognition: traits.litany / 2, energy: 0 })}; a successful activation uses one`}</li>
                )}
            </ul>
            {held && traits.litany !== undefined && (
                <label class="power-traits-compiled" title="How many compilations it holds">
                    Compiled <NumberField field="compiled" class="short" />
                </label>
            )}
            {held && traits.process && (
                <Scope dataId="inProcess" class="power-traits-sustain">
                    {traits.unique ? (
                        <label title="Held in a Process">
                            <input type="checkbox" class="custom" data-id="held" disabled={!canEdit} checked={copies > 0}
                                onChange={e => actions.batch(`${path}.inProcess`, { copies: e.currentTarget.checked ? 1 : 0 })} />
                            In a Process
                        </label>
                    ) : (
                        <label title="How many Processes hold it">In Processes <NumberField field="copies" class="short" /></label>
                    )}
                    {traits.process.x && <label title="The X its Process costs">X <NumberField field="x" class="short" /></label>}
                </Scope>
            )}
        </div>
    );
}

const pillText = ({ copies, cost }: ProcessHeld) => `${copies > 1 ? `×${copies} · ` : ""}${costText(cost)}`;

/** Ends one Process of the power, or drops one of its compilations. */
function DropButton({ power }: { power: ProcessHeld }) {
    const { canEdit, actions } = useSheet();
    if (!canEdit) return null;
    const compiled = power.kind === "compiled";
    return (
        <button type="button" class="sustain-drop" data-id={compiled ? "dropCompiled" : "dropProcess"}
            title={compiled ? "Drop a compilation" : power.copies > 1 ? "End one of its Processes" : "End its Process"}
            onClick={() => (compiled
                ? actions.change(`${power.path}.compiled`, power.copies - 1)
                : actions.batch(`${power.path}.inProcess`, { copies: power.copies - 1 }))}>✕</button>
    );
}

const KIND_LABELS: { [K in ProcessHeld["kind"]]: string } = { process: "Process", compiled: "Compiled" };

/** The powers in Processes, none while the sheet does not count them. */
function useProcesses() {
    const { state } = useSheet();
    return useComputed(() => (technoRule(state, "processes") ? processes(state) : { powers: [], total: { cognition: 0, energy: 0 } })).value;
}

/** The marks of a power held in Processes or compiled, in its header. */
export function ProcessPill({ path }: { path: string }) {
    const held = useProcesses().powers.filter(p => p.path === path);
    return (
        <>
            {held.map(power => (
                <span key={power.kind} class="sustain-pill" data-id={power.kind === "compiled" ? "compiledPill" : "processPill"}
                    title="What it costs each turn">
                    <span class="sustain-text">{`${KIND_LABELS[power.kind]} ${pillText(power)}`}</span>
                    <DropButton power={power} />
                </span>
            ))}
        </>
    );
}

/**
 * What the Processes cost a turn: the total, and a dropdown with what the
 * powers cost and the modifiers of talents and implants, as ResourceField's.
 * Says when the next turn leaves too little ⚙ or 🗲 to keep them.
 */
function ProcessCostField() {
    const { state } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const cost = useComputed(() => processCost(state));
    const text = useComputed(() => costText(cost.value.total));
    const short = useComputed(() => processShortfall(state)).value;
    const hasMods = useItemIds("technoArcana.processCost.mods.items").ids.length > 0;
    const { base, mods } = cost.value;
    const title = [
        `The powers ${costText(base)}, a part rounded up`,
        ...mods.map(m => `${m.name || m.expr} ${signed(m.value)} ${m.resource === "energy" ? "🗲" : "⚙"}`),
    ].join("\n");
    return (
        <span class="resource-stat process-cost">
            Processes Cognition Cost:
            <div class="mod-field resource-field dropdown-parent" ref={ref}>
                <ReadonlyField field="processCostTotal" value={text} class="mod-total" title={title} onClick={dropdown.show} />
                <button type="button" class={dropdown.open ? "mod-toggle active" : "mod-toggle"} title="Modifiers of what the Processes cost"
                    onClick={dropdown.toggle}>⚙</button>
                {dropdown.open && (
                    <Scope dataId="processCost" class="roll-dropdown mod-dropdown resource-dropdown visible">
                        <p class="mod-note-quiet" data-id="powersCost">{`The powers in Processes: ${costText(base)}, a part rounded up`}</p>
                        <div class="mods-header">
                            <span class="column-label">Modifiers</span>
                        </div>
                        {!hasMods && <p class="mod-hint">A talent or implant, as Digital Revelation −1 ⚙.</p>}
                        <ItemGrid dataId="mods.items" class="weapon-mods" itemClass="weapon-mod" idPrefix="process-mod"
                            renderItem={id => <ModRow itemId={id} resource />} />
                        <div class="mod-result">
                            <span class="column-label">Total</span>
                            <span class="mod-result-value" data-id="result">{text}</span>
                        </div>
                    </Scope>
                )}
            </div>
            {short.cognition + short.energy > 0 && (
                <span class="sustain-warning" data-id="processShort">
                    {`${costText(short)} short next turn: end some`}
                </span>
            )}
        </span>
    );
}

/** What the Processes cost a turn in the Techno Arcana bar, and the powers in them under it; a name opens its tab. */
export function ProcessList() {
    const { state, ui } = useSheet();
    const { powers } = useProcesses();
    const shown = useComputed(() => technoRule(state, "processes")).value;
    const tabs = ui.selectedTabSignal("technoArcana.tabs.items");
    return (
        <>
            {shown && (
                <div class="layout-row">
                    <ProcessCostField />
                </div>
            )}
            <div class="layout-row sustained-list process-list">
                {powers.map(power => (
                    <span key={`${power.path}:${power.kind}`} class="sustain-pill" title="What it costs each turn">
                        <button type="button" class="sustain-name" title="Open its tab" onClick={() => { tabs.value = power.tabId; }}>
                            {power.kind === "compiled" ? `${power.name} (compiled)` : power.name}
                        </button>
                        <span class="sustain-text">{pillText(power)}</span>
                        <DropButton power={power} />
                    </span>
                ))}
            </div>
        </>
    );
}
