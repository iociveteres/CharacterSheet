// The phenomena roll of the psykana bar (state/psychic.ts phenomena): 1d100
// with the kick of the last cast, the sustained powers, the power's own
// modifier and other ones. The button stands out when the last cast calls for
// phenomena; whether they happen is the players' call, so it never rolls by
// itself. Shown while the sheet counts phenomena (settings.psykana).
import { useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField, TextField } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { rollExact } from "../rollEvents";
import { phenomena, psykanaRule, type Phenomena as PhenomenaState } from "../state/psychic";
import { rollLabel } from "./rollParts";

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** What the dropdown says of the last cast; short, as the power's own row names it. */
function note({ power }: PhenomenaState): string {
    if (!power) return "No power cast yet.";
    if (power.safe) return "Cast safely, no phenomena.";
    switch (power.reason) {
        case "pushed": return "Pushed, phenomena are certain.";
        case "doubles": return "Doubles on a success.";
        case "99": return "Rolled 99.";
        default: return "No doubles or 99 in the last cast.";
    }
}

function PhenomenaModRow({ itemId }: { itemId: string }) {
    return (
        <Scope dataId={itemId} class="phenomena-mod">
            <Checkbox field="enabled" class="custom" title="Counts in the roll" />
            <TextField field="name" placeholder="Talent, warp storm…" />
            <NumberField field="value" placeholder="0" />
            <DragHandle />
            <DeleteButton itemPath={joinPath(usePath(), itemId)} />
        </Scope>
    );
}

function PhenomenaDropdown({ state, onRoll, onDiscard }: { state: PhenomenaState; onRoll: () => void; onDiscard: () => void }) {
    const value = (key: string) => signed(state.parts.find(p => p.key === key)?.value ?? 0);
    const part = (key: string) => state.parts.find(p => p.key === key)!;
    return (
        <div class="roll-dropdown phenomena-dropdown visible">
            <span class="column-label">Phenomena: 1d100 + modifiers</span>
            <p class={state.power?.reason ? "phenomena-note attention" : "phenomena-note"} data-id="phenomenaNote" title={note(state)}>
                {note(state)}
            </p>
            <div class="phenomena-row" title="Bound +10 for any kick, Unbound +5 and Daemonic +10 per point of kick">
                <span>{part("nature").label}</span>
                <span class="phenomena-value" data-id="nature">{value("nature")}</span>
            </div>
            <div class="phenomena-row" title="Added while any power is sustained; talents and artefacts change it">
                <label>Sustained powers <NumberField field="sustainPenalty" class="short" /></label>
                <span class="phenomena-value" data-id="sustained">{value("sustained")}</span>
            </div>
            <div class="phenomena-row" title="Set under the ⚙ of the power">
                <span>{part("power").label}</span>
                <span class="phenomena-value" data-id="power">{value("power")}</span>
            </div>
            <div class="phenomena-other">
                <span class="column-label">Other</span>
                <span class="phenomena-value" data-id="other">{value("other")}</span>
            </div>
            <ItemGrid dataId="phenomenaMods.items" class="phenomena-mods" itemClass="phenomena-mod" idPrefix="phenomena-mod"
                renderItem={id => <PhenomenaModRow itemId={id} />} />
            <div class="phenomena-result">
                <span class="column-label">Total</span>
                <span class="phenomena-total" data-id="phenomenaTotal">{`1d100${state.total === 0 ? "" : signed(state.total)}`}</span>
                {state.power?.reason && (
                    <button type="button" class="phenomena-discard" data-id="discardPhenomena"
                        title="No phenomena this time: stop calling for them" onClick={onDiscard}>Discard</button>
                )}
                <button type="button" class="button-colored" data-id="rollPhenomena" onClick={onRoll}>Roll</button>
            </div>
        </div>
    );
}

export function PhenomenaRoll() {
    const { actions, canEdit } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const shown = useComputed(() => psykanaRule("phenomena")).value;
    const state = useComputed(phenomena);
    if (!shown) return null;
    const called = !!state.value.power?.reason;
    // Rolled or discarded, the button no longer calls for them.
    const settle = () => {
        const { power } = state.peek();
        // Rolled from a sheet the player only views, the roll changes nothing on it.
        if (power?.reason && canEdit) actions.change(`${power.path}.cast.phenomena`, "");
        dropdown.close();
    };
    const roll = () => {
        const { total, power } = state.peek();
        const kick = power && !power.safe && power.kick > 0 ? [`+${power.kick} kick`] : [];
        rollExact(`1d100${total === 0 ? "" : signed(total)}`, rollLabel("Phenomena", power ? [power.name, ...kick] : []));
        settle();
    };
    return (
        <div class="phenomena-roll dropdown-parent" ref={ref}>
            <button type="button" data-id="phenomenaToggle"
                class={`phenomena-toggle button-colored${called ? " attention" : ""}${dropdown.open ? " active" : ""}`}
                title={called ? note(state.value) : "Roll the phenomena of the last cast"} onClick={dropdown.toggle}>
                Phenomena
            </button>
            {dropdown.open && <PhenomenaDropdown state={state.value} onRoll={roll} onDiscard={settle} />}
        </div>
    );
}
