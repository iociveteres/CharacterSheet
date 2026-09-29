// Tech powers by the rules (state/tech.ts): the price in a power's roll
// dropdown, its traits under its ⚙, the mark of a power held in Processes
// and the list of them in the Techno Arcana bar.
import type { Signal } from "@preact/signals-core";
import { useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { NumberField } from "../components/fields";
import { Scope } from "../components/Scope";
import { numberAt } from "../state/sync";
import { selectedTabSignal } from "../state/ui";
import {
    COGNITION, ENERGY, costText, processAfterActivation, processes, techTraitsAt, technoRule, type ProcessHeld, type TechTraits,
} from "../state/tech";

/** Whether the character has the ⚙ an activation of a power with `traits` spends before its test. */
export const hasCognitionFor = (traits: TechTraits) => !technoRule("price") || traits.price.cognition <= numberAt(COGNITION);

/**
 * The price of an activation, its X, how much of its 🗲 to pay with Fatigue,
 * and whether a successful one holds the power in a Process; a row under the
 * columns of the roll dropdown. Says what the character lacks: without the
 * ⚙ the power is not rolled, the 🗲 short is paid with Fatigue.
 */
export function PriceColumn({ path, traits, process, asFatigue }: {
    path: string; traits: TechTraits; process: Signal<boolean>; asFatigue: Signal<number>;
}) {
    const paid = useComputed(() => technoRule("price")).value;
    const held = useComputed(() => technoRule("processes")).value && !!traits.process;
    const { price } = traits;
    const cognition = numberAt(COGNITION);
    const energy = numberAt(ENERGY);
    const fromEnergy = Math.max(0, price.energy - asFatigue.value);
    // The Doctrines this activation would end.
    const names = useComputed(() => {
        const changes = processAfterActivation(path, numberAt(`${path}.roll.x`));
        return processes().powers.filter(p => p.path !== path && changes.has(p.path)).map(p => p.name);
    }).value;
    if (!paid && !held && !price.x) return null;
    return (
        <div class="roll-column sustain-column price-column">
            <label class="column-label">Price</label>
            <div class="roll-column-content">
                {paid && <span class="price-text" data-id="priceText"
                    title="⚙ is spent before the test, 🗲 only once it succeeds">
                    {price.energy > 0 ? `${costText({ ...price, energy: 0 })} · ${costText({ cognition: 0, energy: price.energy })} on success` : costText(price)}
                </span>}
                {price.x && <label class="sustain-option" title="The X of the price, and of the Process">X <NumberField field="x" class="short" /></label>}
                {paid && price.energy > 0 && (
                    <label class="sustain-option" title="🗲 of the price paid with 1 Fatigue each instead, as the rules allow">
                        <input type="number" class="short" data-id="energyAsFatigue" min={0} max={price.energy} value={asFatigue.value}
                            onInput={e => { asFatigue.value = Math.min(price.energy, Math.max(0, parseInt(e.currentTarget.value, 10) || 0)); }} />
                        🗲 as Fatigue
                    </label>
                )}
                {held && traits.process && (
                    <label class="sustain-option" title={`Holds it in a Process if the activation succeeds: ${costText(traits.process)} a turn`}>
                        <input type="checkbox" class="custom" data-id="holdInProcess" checked={process.value}
                            onChange={e => { process.value = e.currentTarget.checked; }} />
                        {traits.unique ? "Process (unique)" : "Process"}
                    </label>
                )}
                {held && process.value && names.length > 0 && (
                    <span class="sustain-note" data-id="endsDoctrine">{`Ends ${names.join(", ")}: one Doctrine at a time`}</span>
                )}
                {paid && price.cognition > cognition && (
                    <span class="pr-warning" data-id="noCognition">{`${cognition} of ${Math.ceil(price.cognition)} ⚙: not enough to activate`}</span>
                )}
                {paid && fromEnergy > energy && (
                    <span class="pr-warning" data-id="noEnergy" title="Each 🗲 short is paid with 1 Fatigue">
                        {`${energy} of ${fromEnergy} 🗲: the rest as Fatigue`}
                    </span>
                )}
            </div>
        </div>
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
    const { canEdit, actions } = useSheet();
    const traits = useComputed(() => techTraitsAt(path, numberAt(`${path}.inProcess.x`))).value;
    const held = useComputed(() => technoRule("processes")).value;
    const copies = numberAt(`${path}.inProcess.copies`);
    return (
        <div class="roll-dropdown power-traits-dropdown visible">
            <span class="column-label">From Price, Process, Subtypes and Test</span>
            <ul class="power-traits-list" data-id="traits">
                <li>{`Price ${costText(traits.price)}${traits.price.x ? " (X of the roll)" : ""}: ⚙ before the test, 🗲 on success`}</li>
                <li>{traits.process
                    ? `Process ${costText(traits.process)} a turn${traits.unique ? ", unique: held once at most" : ""}`
                    : "No Process"}</li>
                {traits.doctrine && <li>Doctrine: one at a time in the Processes</li>}
                {traits.auto && <li>Tested automatically: activated without a roll</li>}
            </ul>
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

/** Ends one Process of the power. */
function DropButton({ power }: { power: ProcessHeld }) {
    const { canEdit, actions } = useSheet();
    if (!canEdit) return null;
    return (
        <button type="button" class="sustain-drop" data-id="dropProcess"
            title={power.copies > 1 ? "End one of its Processes" : "End its Process"}
            onClick={() => actions.batch(`${power.path}.inProcess`, { copies: power.copies - 1 })}>✕</button>
    );
}

/** The powers in Processes, none while the sheet does not count them. */
const useProcesses = () => useComputed(() => (technoRule("processes") ? processes() : { powers: [], total: { cognition: 0, energy: 0 } })).value;

/** The mark of a power held in Processes, in its header. */
export function ProcessPill({ path }: { path: string }) {
    const power = useProcesses().powers.find(p => p.path === path);
    if (!power) return null;
    return (
        <span class="sustain-pill" data-id="processPill" title="What it costs each turn">
            <span class="sustain-text">{`Process ${pillText(power)}`}</span>
            <DropButton power={power} />
        </span>
    );
}

/** The powers in Processes in the Techno Arcana bar and what they cost a turn; a name opens its tab. */
export function ProcessList() {
    const { powers, total } = useProcesses();
    const tabs = selectedTabSignal("technoArcana.tabs.items");
    return (
        <div class="layout-row sustained-list" data-id="processList">
            {powers.length > 0 && (
                <span class="process-total" data-id="processTotal" title="What the Processes cost each turn, a part rounded up">
                    {`Processes: ${costText(total)} a turn`}
                </span>
            )}
            {powers.map(power => (
                <span key={power.path} class="sustain-pill" title="What it costs each turn">
                    <button type="button" class="sustain-name" title="Open its tab" onClick={() => { tabs.value = power.tabId; }}>
                        {power.name}
                    </button>
                    <span class="sustain-text">{pillText(power)}</span>
                    <DropButton power={power} />
                </span>
            ))}
        </div>
    );
}
