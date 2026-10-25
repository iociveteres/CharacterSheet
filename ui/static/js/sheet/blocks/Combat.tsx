// The small blocks of the combat tab: infamy (fame in Pathfinder Crusade),
// fatigue, initiative with size, and movement: a table of its modes on the
// tab, the modes themselves under the ⚙ of its heading (state/movement.ts).
import { useEffect, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { untracked } from "@preact/signals-core";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField, ReadonlyField, Select, TextField } from "../components/fields";
import { hoverTitle } from "../components/hoverTitle";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { SuggestField } from "../components/SuggestField";
import { useItemIds } from "../components/useItemIds";
import { MOVEMENT_REFS } from "../damage";
import { movementSummary } from "../state/characteristicSummary";
import { refKeys } from "../state/damage";
import { idsInOrder } from "../state/gridOrder";
import { MOVE_COLUMNS, modeName, spdValue } from "../state/movement";
import { modeNameSuggestions, movementInsert, movementSuggestions } from "../state/movementSuggestions";
import { numberAt, textAt, valueAt } from "../state/sync";
import { ExprInput } from "./ModdedField";
import { Scope } from "../components/Scope";
import { initiativeTotal, rollInitiative } from "../state/initiative";
import { FATIGUE_MODES, INITIATIVE_BONUSES, SIZE_OPTIONS } from "../schema/constants";
import { collectEntries } from "../state/computed";
import { isCharacteristic } from "../state/testOptions";
import { FATIGUE_THRESHOLD, fatigueThreshold } from "../state/resourceStat";
import { resolveStackExpr, signed } from "../system";
import { StatField, type StatTexts } from "./ResourceField";

export function Infamy() {
    return (
        <Scope dataId="infamyPoints">
            <div class="layout-row">
                <div class="layout-row">
                    <label>Threshold:</label>
                    <NumberField field="infamyMax" class="short-input" />
                </div>
                <div class="layout-row l">
                    <label>Current:</label>
                    <NumberField field="infamyCur" class="short-input" />
                </div>
            </div>
            <div class="layout-row content-center margin-top-small">
                <label>Temporary:</label>
                <NumberField field="infamyTemp" class="short-input" />
            </div>
        </Scope>
    );
}

function FatigueIndicator() {
    const { state } = useSheet();
    const cur = Number(valueAt(state, "fatigue.fatigueCur")) || 0;
    const threshold = useComputed(() => fatigueThreshold(state).total).value;
    const [text, active] = cur <= 0 ? ["Not affected", false]
        : threshold > 0 && cur >= threshold ? ["Unconscious", true]
            : ["Taking −10 to affected rolls", true];
    return <span data-id="fatigueIndicator" class={active ? "fatigue-indicator fatigue-active" : "fatigue-indicator"}>{text}</span>;
}

const THRESHOLD_TEXTS: StatTexts = {
    noun: "fatigue threshold",
    rule: FATIGUE_THRESHOLD,
    hint: "A talent or trait, as +1 or ½T.b.",
};

export function Fatigue() {
    return (
        <Scope dataId="fatigue">
            <div class="layout-row items-center">
                <label>Current:
                    <NumberField field="fatigueCur" class="short-input" />
                </label>
                {/* Not a label: a click in its dropdown would go to the total. */}
                <span class="resource-stat">Threshold:
                    <StatField field="threshold" texts={THRESHOLD_TEXTS} fallback={FATIGUE_THRESHOLD} value={fatigueThreshold} />
                </span>
            </div>
            <div class="layout-column items-center margin-top-small">
                <label>Affects:
                    <Select field="fatigueMode" options={FATIGUE_MODES} />
                </label>
                <FatigueIndicator />
            </div>
        </Scope>
    );
}

// The bases in rows: WS to A, I to F, then Cor and Inf or Fa.
const BASE_ROWS = [INITIATIVE_BONUSES.slice(0, 5), INITIATIVE_BONUSES.slice(5, 9), INITIATIVE_BONUSES.slice(9)];

/** Initiative bonuses of conditions, gear and implants, under the initiative settings. */
function InitiativeContributions() {
    const { state } = useSheet();
    const sources = collectEntries(state, "initiative_bonus")
        .map(({ entry, stacks, source }) => ({
            name: String(source.name?.value || "—"),
            bonus: resolveStackExpr(entry.initiativeBonus?.value, stacks),
        }))
        .filter(s => s.bonus);
    return (
        <div class="initiative-condition-contributions">
            {sources.length > 0 && <div class="initiative-contributions-header">Bonuses</div>}
            {sources.map((s, i) => (
                <div key={i} class="layout-row initiative-contribution-row">
                    <span>{s.name}</span>
                    <span>{signed(s.bonus)}</span>
                </div>
            ))}
        </div>
    );
}

function LastInitiative() {
    const { state } = useSheet();
    const total = initiativeTotal(state);
    const title = total === null ? undefined
        : `Roll: ${numberAt(state, "initiative.lastInitiative")}, Modifiers: ${signed(numberAt(state, "initiative.modifier"))}, Total: ${total}`;
    return (
        <span id="initiativeResult" class={total === null ? undefined : "has-result"} title={title}>
            <span class="initiative-label">Latest initiative:</span>
            <span id="lastInitiativeDisplay">{total === null ? "" : String(total)}</span>
        </span>
    );
}

export function InitiativeAndSize() {
    const sheet = useSheet();
    const { state } = sheet;
    const wrapper = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(wrapper);
    const roll = String(valueAt(state, "initiative.initiative") ?? "");

    return (
        <>
            <div class="layout-column">
                <h3>Initiative</h3>
                <div class="initiative-wrapper" ref={wrapper}>
                    <div class="layout-row content-center">
                        <label class="rollable" onClick={() => void rollInitiative(sheet)}>Initiative:</label>
                        <input
                            class="short-input uneditable textlike"
                            id="initiativeRoll"
                            type="text"
                            readOnly
                            tabIndex={-1}
                            value={roll}
                            onMouseDown={e => e.preventDefault()}
                            onClick={dropdown.show}
                        />
                        <button
                            class={dropdown.open ? "initiative-dropdown-toggle active" : "initiative-dropdown-toggle"}
                            type="button"
                            onClick={dropdown.toggle}
                        >
                            {dropdown.open ? "▲" : "▼"}
                        </button>
                    </div>
                    {dropdown.open && <Scope dataId="initiative" class="initiative-dropdown visible">
                        <div class="layout-row">
                            <label>
                                Dice:<TextField field="dice" class="short-input" />
                            </label>
                        </div>
                        <fieldset>
                            <legend>Characteristic Bases</legend>
                            {BASE_ROWS.map((row, i) => (
                                <div key={i} class="layout-row">
                                    {row.filter(b => isCharacteristic(sheet.stats, b.characteristic)).map(({ characteristic, field }) => (
                                        <label key={field}><Checkbox field={field} class="custom" /> {`${characteristic}.b`}</label>
                                    ))}
                                </div>
                            ))}
                        </fieldset>
                        <div class="layout-row">
                            <label>
                                Flat bonus:<NumberField field="flatBonus" class="short-input" />
                            </label>
                        </div>
                        <InitiativeContributions />
                    </Scope>}
                </div>
                <LastInitiative />
            </div>
            <div class="layout-column items-center">
                <h3>Size</h3>
                <Select field="size" options={SIZE_OPTIONS} numeric />
            </div>
        </>
    );
}

const MODES = "movement.modes.items";

/** The distances of each mode, a row each, with how each is counted on hover. */
export function Movement() {
    const { state } = useSheet();
    useItemIds(MODES);
    const ids = idsInOrder(state, MODES);
    return (
        <Scope as="table" dataId="movement" class="movement-table">
            <thead>
                <tr>
                    <th />
                    {MOVE_COLUMNS.map(c => <th key={c.key}>{c.label}</th>)}
                </tr>
            </thead>
            <tbody>
                {ids.map(id => (
                    <Scope as="tr" key={id} dataId={`modes.items.${id}`}>
                        <th class="movement-name" data-id="name">{modeName(state, `${MODES}.${id}`)}</th>
                        {MOVE_COLUMNS.map(c => (
                            <td key={c.key}>
                                <ReadonlyField field={c.key} class="movement-distance textlike"
                                    {...hoverTitle(() => movementSummary(state, `${MODES}.${id}`, c))} />
                            </td>
                        ))}
                    </Scope>
                ))}
                {ids.length === 0 && (
                    <tr><td class="movement-empty" colSpan={MOVE_COLUMNS.length + 1}>No movement modes: add one under ⚙</td></tr>
                )}
            </tbody>
        </Scope>
    );
}

const SPD_TITLE = [
    "The SPD of the mode:",
    "A.b+Size — on foot, by the rules",
    "6 — Flyer (6), Hoverer (6), Burrower (6): their number, size ignored",
    "½S.b — swimming, half the Strength bonus; ½S.b▲ rounds up",
    "A.b+Size+2 — with a bonus of the mode",
    "2×A.b+2×Size — twice, as Quadruped",
    "Case does not matter. SPD of 0 or less counts as 0.5.",
    "The conditions' movement bonus adds to every mode.",
].join("\n");

/** A mode under the ⚙ of the movement: its name, SPD and the multipliers of its distances. */
function ModeRow({ itemId }: { itemId: string }) {
    const { state, stats } = useSheet();
    const path = joinPath(usePath(), itemId);
    const expr = textAt(state, `${path}.spd`);
    const value = useComputed(() => spdValue(state, textAt(state, `${path}.spd`))).value;
    return (
        <Scope dataId={itemId} class="movement-mode">
            <div class="weapon-mod movement-mode-head">
                <span class="mod-name-wrap">
                    <SuggestField field="name" class="mod-name" placeholder="Mode" title="The way it moves: Land, Flight, Swim…"
                        suggest={query => modeNameSuggestions(state, query)} />
                </span>
                <ExprInput path={path} field="spd" keys={refKeys(state)} named={MOVEMENT_REFS} placeholder="A.b+Size" title={SPD_TITLE}
                    empty={expr.trim() && value === null ? "Reads as no number" : null} off="The mode has no distances."
                    suggest={query => movementSuggestions(state, stats.characteristics, query)} insert={movementInsert(state)} />
                <span class="mod-added" data-id="spdValue" title="The SPD, before the conditions">{value === null ? "—" : `= ${value}`}</span>
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="movement-mults">
                {MOVE_COLUMNS.map(c => (
                    <label key={c.key} class="movement-mult" title={`${c.label}: the SPD times this, ${c.byDefault} by the rules`}>
                        <span class="column-label">{`${c.label} ×`}</span>
                        <NumberField field={c.mult} />
                    </label>
                ))}
            </div>
        </Scope>
    );
}

/** The heading of the movement, with the ⚙ of its modes just right of it. */
export function MovementHeading() {
    const { state } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const { ids } = useItemIds(MODES);
    // Add puts the caret into the name of the mode it made, not of one another player adds.
    const before = useRef<string[] | null>(null);
    useEffect(() => {
        const old = before.current;
        if (!old) return;
        const added = ids.find(id => !old.includes(id));
        if (!added) return;
        before.current = null;
        listRef.current?.querySelector<HTMLInputElement>(`[data-id="${added}"] input.mod-name`)?.focus();
    }, [ids.join(",")]);
    return (
        <div class="block-heading-block">
            <div class="block-heading">
                <h3>Movement</h3>
                <div class="block-settings dropdown-parent" ref={ref}>
                    <button type="button" class={dropdown.open ? "block-settings-toggle movement-toggle active" : "block-settings-toggle movement-toggle"}
                        title="Movement modes" onClick={dropdown.toggle}>⚙</button>
                    {dropdown.open && (
                        <div class="roll-dropdown block-settings-dropdown mod-dropdown movement-dropdown visible" ref={listRef}
                            onClickCapture={e => {
                                if ((e.target as Element).closest(".add-button")) before.current = untracked(() => idsInOrder(state, MODES));
                            }}>
                            <span class="column-label">Movement modes</span>
                            {ids.length === 0 && <p class="mod-hint">A mode is a name and its SPD, as Flight and 6.</p>}
                            <Scope dataId="movement">
                                <ItemGrid dataId="modes.items" class="movement-modes" itemClass="movement-mode" idPrefix="mode"
                                    addLabel="＋ Add mode" renderItem={id => <ModeRow itemId={id} />} />
                            </Scope>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
