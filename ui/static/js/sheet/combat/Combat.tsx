// The small blocks of the combat tab: infamy (fame in Pathfinder Crusade),
// fatigue, initiative with size, and movement: a table of its modes on the
// tab, the modes themselves under the ⚙ of its heading (combat/movement.ts).
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
import { MOVEMENT_REFS } from "../rolls/damageExpression";
import { movementSummary } from "./movementSummary";
import { refKeys } from "../rolls/damage";
import { idsInOrder } from "../core/gridOrder";
import { MOVE_COLUMNS, modeName, spdValue } from "./movement";
import { modeNameSuggestions, movementInsert, movementSuggestions } from "./movementSuggestions";
import { numberAt, textAt, valueAt } from "../core/sync";
import { ExprInput } from "../rolls/ModdedField";
import { Scope } from "../components/Scope";
import { initiativeTotal, rollInitiative } from "./initiative";
import { FATIGUE_MODES, INITIATIVE_BONUSES, SIZE_OPTIONS } from "../schema/constants";
import { collectEntries } from "../modifiers/entries";
import { isCharacteristic } from "../rolls/testOptionRules";
import { FATIGUE_THRESHOLD, fatigueThreshold } from "../rolls/resourceStat";
import { resolveStackExpr } from "../modifiers/entryValues";
import { signed } from "../components/format";
import { StatField, type StatTexts } from "../rolls/ResourceField";
import { stanceOf } from "../weapons/stanceRules";
import { t } from "../../i18n";

export function Infamy() {
    return (
        <Scope dataId="infamyPoints">
            <div class="layout-row">
                <div class="layout-row">
                    <label>{t("sheet.combat.threshold")}:</label>
                    <NumberField field="infamyMax" class="short-input" />
                </div>
                <div class="layout-row l">
                    <label>{t("sheet.combat.current")}:</label>
                    <NumberField field="infamyCur" class="short-input" />
                </div>
            </div>
            <div class="layout-row content-center margin-top-small">
                <label>{t("sheet.combat.temporary")}:</label>
                <NumberField field="infamyTemp" class="short-input" />
            </div>
        </Scope>
    );
}

function FatigueIndicator() {
    const { state } = useSheet();
    const cur = Number(valueAt(state, "fatigue.fatigueCur")) || 0;
    const threshold = useComputed(() => fatigueThreshold(state).total).value;
    const [text, active] = cur <= 0 ? [t("sheet.combat.fatigue.notAffected"), false]
        : threshold > 0 && cur >= threshold ? [t("sheet.combat.fatigue.unconscious"), true]
            : [t("sheet.combat.fatigue.penalty"), true];
    return <span data-id="fatigueIndicator" class={active ? "fatigue-indicator fatigue-active" : "fatigue-indicator"}>{text}</span>;
}

const THRESHOLD_TEXTS: StatTexts = {
    noun: t("sheet.combat.fatigue.thresholdNoun"),
    rule: FATIGUE_THRESHOLD,
    hint: t("sheet.combat.fatigue.thresholdHint"),
};

export function Fatigue() {
    return (
        <Scope dataId="fatigue">
            <div class="layout-row items-center">
                <label>{t("sheet.combat.current")}:
                    <NumberField field="fatigueCur" class="short-input" />
                </label>
                {/* Not a label: a click in its dropdown would go to the total. */}
                <span class="resource-stat">{t("sheet.combat.threshold")}:
                    <StatField field="threshold" texts={THRESHOLD_TEXTS} fallback={FATIGUE_THRESHOLD} value={fatigueThreshold} />
                </span>
            </div>
            <div class="layout-column items-center margin-top-small">
                <label>{t("sheet.combat.fatigue.affects")}:
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
            {sources.length > 0 && <div class="initiative-contributions-header">{t("sheet.combat.initiative.bonuses")}</div>}
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
        : t("sheet.combat.initiative.lastTitle", {
            roll: numberAt(state, "initiative.lastInitiative"),
            modifier: signed(numberAt(state, "initiative.modifier")),
            total,
        });
    return (
        <span id="initiativeResult" class={total === null ? undefined : "has-result"} title={title}>
            <span class="initiative-label">{t("sheet.combat.initiative.latest")}:</span>
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
                <h3>{t("sheet.terms.stat.initiative")}</h3>
                <div class="initiative-wrapper" ref={wrapper}>
                    <div class="layout-row content-center">
                        <label class="rollable" onClick={() => void rollInitiative(sheet)}>{t("sheet.terms.stat.initiative")}:</label>
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
                                {t("sheet.combat.initiative.dice")}:<TextField field="dice" class="short-input" />
                            </label>
                        </div>
                        <fieldset>
                            <legend>{t("sheet.combat.initiative.bases")}</legend>
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
                                {t("sheet.combat.initiative.flatBonus")}:<NumberField field="flatBonus" class="short-input" />
                            </label>
                        </div>
                        <InitiativeContributions />
                    </Scope>}
                </div>
                <LastInitiative />
            </div>
            <div class="layout-column items-center">
                <h3>{t("sheet.terms.stat.size")}</h3>
                <Select field="size" options={SIZE_OPTIONS} numeric />
            </div>
        </>
    );
}

const MODES = "movement.modes.items";

/** The distances the Palisade stance forbids. */
const NOT_IN_PALISADE: readonly string[] = ["charge", "run"];
const PALISADE_NOTE = t("sheet.combat.movement.palisade");

/**
 * The distances of each mode, a row each, with how each is counted on hover.
 * In the Palisade stance Charge and Run are dimmed.
 */
export function Movement() {
    const { state } = useSheet();
    useItemIds(MODES);
    const ids = idsInOrder(state, MODES);
    const palisade = stanceOf(state).key === "palisade";
    const dimmed = (key: string) => palisade && NOT_IN_PALISADE.includes(key);
    return (
        <Scope as="table" dataId="movement" class="movement-table">
            <thead>
                <tr>
                    <th />
                    {MOVE_COLUMNS.map(c => (dimmed(c.key)
                        ? <th key={c.key} class="dimmed" title={PALISADE_NOTE}>{c.label}</th>
                        : <th key={c.key}>{c.label}</th>))}
                </tr>
            </thead>
            <tbody>
                {ids.map(id => (
                    <Scope as="tr" key={id} dataId={`modes.items.${id}`}>
                        <th class="movement-name" data-id="name">{modeName(state, `${MODES}.${id}`)}</th>
                        {MOVE_COLUMNS.map(c => (
                            <td key={c.key}>
                                <ReadonlyField field={c.key} class={dimmed(c.key) ? "movement-distance textlike dimmed" : "movement-distance textlike"}
                                    {...hoverTitle(() => {
                                        const lines = movementSummary(state, `${MODES}.${id}`, c);
                                        return dimmed(c.key) ? [PALISADE_NOTE, ...lines] : lines;
                                    })} />
                            </td>
                        ))}
                    </Scope>
                ))}
                {ids.length === 0 && (
                    <tr><td class="movement-empty" colSpan={MOVE_COLUMNS.length + 1}>{t("sheet.combat.movement.empty")}</td></tr>
                )}
            </tbody>
        </Scope>
    );
}

const SPD_TITLE = t("sheet.combat.movement.spdTitle");

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
                    <SuggestField field="name" class="mod-name" placeholder={t("sheet.combat.movement.mode")} title={t("sheet.combat.movement.modeTitle")}
                        suggest={query => modeNameSuggestions(state, query)} />
                </span>
                <ExprInput path={path} field="spd" keys={refKeys(state)} named={MOVEMENT_REFS} placeholder="A.b+Size" title={SPD_TITLE}
                    empty={expr.trim() && value === null ? t("sheet.combat.movement.noNumber") : null} off={t("sheet.combat.movement.noDistances")}
                    suggest={query => movementSuggestions(state, stats.characteristics, query)} insert={movementInsert(state)} />
                <span class="mod-added" data-id="spdValue" title={t("sheet.combat.movement.spdBefore")}>{value === null ? "—" : `= ${value}`}</span>
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="movement-mults">
                {MOVE_COLUMNS.map(c => (
                    <label key={c.key} class="movement-mult" title={t("sheet.combat.movement.multTitle", { column: c.label, mult: c.byDefault })}>
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
                <h3>{t("sheet.terms.stat.movement")}</h3>
                <div class="block-settings dropdown-parent" ref={ref}>
                    <button type="button" class={dropdown.open ? "block-settings-toggle movement-toggle active" : "block-settings-toggle movement-toggle"}
                        title={t("sheet.combat.movement.modes")} onClick={dropdown.toggle}>⚙</button>
                    {dropdown.open && (
                        <div class="roll-dropdown block-settings-dropdown mod-dropdown movement-dropdown visible" ref={listRef}
                            onClickCapture={e => {
                                if ((e.target as Element).closest(".add-button")) before.current = untracked(() => idsInOrder(state, MODES));
                            }}>
                            <span class="column-label">{t("sheet.combat.movement.modes")}</span>
                            {ids.length === 0 && <p class="mod-hint">{t("sheet.combat.movement.modesHint")}</p>}
                            <Scope dataId="movement">
                                <ItemGrid dataId="modes.items" class="movement-modes" itemClass="movement-mode" idPrefix="mode"
                                    addLabel={t("sheet.combat.movement.addMode")} renderItem={id => <ModeRow itemId={id} />} />
                            </Scope>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
