// The small blocks of the combat tab: infamy, fatigue, initiative with size,
// and movement.
import { useEffect, useRef } from "preact/hooks";
import { useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField, ReadonlyField, Select, TextField, peekAt, valueAt } from "../components/fields";
import { Scope } from "../components/Scope";
import { rollExact } from "../rollEvents";
import { FATIGUE_MODES, INITIATIVE_BONUSES, SIZE_OPTIONS } from "../schema/constants";
import { collectEntries } from "../state/computed.js";
import { resolveStackExpr, signed } from "../system.js";

type Entry = { entry: { [field: string]: { value: unknown } | undefined }; stacks: number; source: { name?: { value: unknown } } };

const entries = (type: string) => collectEntries(type) as Entry[];

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
    const cur = Number(valueAt("fatigue.fatigueCur")) || 0;
    const threshold = Number(valueAt("fatigue.fatigueMax")) || 0;
    const [text, active] = cur <= 0 ? ["Not affected", false]
        : threshold > 0 && cur >= threshold ? ["Unconscious", true]
            : ["Taking −10 to affected rolls", true];
    return <span data-id="fatigueIndicator" class={active ? "fatigue-indicator fatigue-active" : "fatigue-indicator"}>{text}</span>;
}

export function Fatigue() {
    return (
        <Scope dataId="fatigue">
            <div class="layout-row items-center">
                <label>Current:
                    <NumberField field="fatigueCur" class="short-input" />
                </label>
                <label>Threshold:
                    <NumberField field="fatigueMax" class="short-input" />
                </label>
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

// The bases in rows: WS to A, I to F, then Cor and Inf.
const BASE_ROWS = [INITIATIVE_BONUSES.slice(0, 5), INITIATIVE_BONUSES.slice(5, 9), INITIATIVE_BONUSES.slice(9)];

/** Initiative bonuses of conditions, gear and implants, under the initiative settings. */
function InitiativeContributions() {
    const sources = entries("initiative_bonus")
        .map(({ entry, stacks, source }) => ({
            name: String(source.name?.value || "—"),
            bonus: resolveStackExpr(entry.initiativeBonus?.value as string, stacks),
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

/**
 * Keeps the raw roll of the last initiative: the room answers an initiative
 * roll with a chat message of this character, and its total less the current
 * modifier is stored. Returns what to call before the roll.
 */
function useLastInitiative(): () => void {
    const { actions } = useSheet();
    const pending = useRef(new Set<string>());
    useEffect(() => {
        const onChat = (e: Event) => {
            const { characterName: name, commandResult } = (e as CustomEvent).detail ?? {};
            if (!name || !commandResult || !pending.current.has(name)) return;
            const totalMatch = String(commandResult).match(/=\s*(-?\d+)\s*$/);
            if (!totalMatch) return;
            pending.current.delete(name);
            const raw = parseInt(totalMatch[1], 10) - (Number(peekAt("initiative.modifier")) || 0);
            actions.change("initiative.lastInitiative", raw);
        };
        document.addEventListener("ws:chatMessage", onChat);
        return () => document.removeEventListener("ws:chatMessage", onChat);
    }, [actions]);

    return () => {
        const name = String(peekAt("characterInfo.characterName") ?? "").trim();
        if (name) pending.current.add(name);
    };
}

function LastInitiative() {
    const raw = Number(valueAt("initiative.lastInitiative")) || 0;
    const modifier = Number(valueAt("initiative.modifier")) || 0;
    const total = raw + modifier;
    const title = raw ? `Roll: ${raw}, Modifiers: ${signed(modifier)}, Total: ${total}` : undefined;
    return (
        <span id="initiativeResult" class={raw ? "has-result" : undefined} title={title}>
            <span class="initiative-label">Latest initiative:</span>
            <span id="lastInitiativeDisplay">{raw ? String(total) : ""}</span>
        </span>
    );
}

export function InitiativeAndSize() {
    const wrapper = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(wrapper);
    const expectInitiative = useLastInitiative();
    const roll = String(valueAt("initiative.initiative") ?? "");

    return (
        <>
            <div class="layout-column">
                <h3>Initiative</h3>
                <div class="initiative-wrapper" ref={wrapper}>
                    <div class="layout-row content-center">
                        <label class="rollable" onClick={() => {
                            if (!roll.trim()) return;
                            expectInitiative();
                            rollExact(roll.trim(), "Initiative");
                        }}>Initiative:</label>
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
                    <Scope dataId="initiative" class={dropdown.open ? "initiative-dropdown visible" : "initiative-dropdown"}>
                        <div class="layout-row">
                            <label>
                                Dice:<TextField field="dice" class="short-input" />
                            </label>
                        </div>
                        <fieldset>
                            <legend>Characteristic Bases</legend>
                            {BASE_ROWS.map((row, i) => (
                                <div key={i} class="layout-row">
                                    {row.map(({ characteristic, field }) => (
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
                    </Scope>
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

const MOVE_TOOLTIP = "Result = A.b + Size + Bonus\nOther bonuses:";

function MoveCell({ field, title }: { field: string; title?: string }) {
    return <div class="movement-cell"><ReadonlyField field={field} type="number" class="short-input textlike" title={title} /></div>;
}

function MultiplierCell({ field }: { field: string }) {
    return (
        <div class="movement-cell">
            <label class="movement-inline-label">×</label>
            <NumberField field={field} class="short-input movement-mult" />
        </div>
    );
}

export function Movement() {
    const bonuses = entries("movement_bonus").map(({ entry, stacks }) =>
        `${entry.name?.value || "?"}: ${signed(resolveStackExpr(entry.movementBonus?.value as string, stacks))}`);
    const halfTitle = bonuses.length ? `${MOVE_TOOLTIP}\n${bonuses.join("\n")}` : MOVE_TOOLTIP;

    return (
        <Scope dataId="movement" class="movement-section">
            <div class="movement-row">
                {["Half Move", "Full Move", "Charge", "Run"].map(label => (
                    <div key={label} class="movement-cell">
                        <div class="label-cell"><label class="movement-label">{label}</label></div>
                    </div>
                ))}
            </div>
            <div class="movement-row">
                <MoveCell field="moveHalf" title={halfTitle} />
                <MoveCell field="moveFull" />
                <MoveCell field="moveCharge" />
                <MoveCell field="moveRun" />
            </div>
            <div class="movement-row">
                <div class="movement-cell">
                    <label class="movement-inline-label">Bonus:</label>
                    <NumberField field="bonus" class="short-input" />
                </div>
                <MultiplierCell field="fullMult" />
                <MultiplierCell field="chargeMult" />
                <MultiplierCell field="runMult" />
            </div>
        </Scope>
    );
}
