// The small blocks of the combat tab: infamy, fatigue, initiative with size,
// and movement.
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { useSheet } from "../components/context";
import { useDismiss } from "../components/Dropdown";
import { Checkbox, NumberField, ReadonlyField, Select, TextField, peekAt, valueAt } from "../components/fields";
import { Scope } from "../components/Scope";
import { rollExact } from "../rollEvents";
import { collectEntries } from "../state/computed.js";
import { resolveStackExpr } from "../system.js";

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

const FATIGUE_MODES = [
    { value: "all", label: "All" },
    { value: "mental", label: "Mental" },
    { value: "physical", label: "Physical" },
    { value: "nothing", label: "Nothing" },
];

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

const BASES: readonly (readonly [string, string][])[] = [
    [["wsBonus", "WS.b"], ["bsBonus", "BS.b"], ["sBonus", "S.b"], ["tBonus", "T.b"], ["aBonus", "A.b"]],
    [["iBonus", "I.b"], ["pBonus", "P.b"], ["wBonus", "W.b"], ["fBonus", "F.b"]],
    [["corBonus", "Cor.b"], ["infBonus", "Inf.b"]],
];

const SIZES = [
    { value: "-3", label: "Miniscule (-3)" },
    { value: "-2", label: "Puny (-2)" },
    { value: "-1", label: "Weedy (-1)" },
    { value: "0", label: "Average (0)" },
    { value: "1", label: "Hulking (1)" },
    { value: "2", label: "Enormous (2)" },
    { value: "3", label: "Massive (3)" },
    { value: "4", label: "Immense (4)" },
    { value: "5", label: "Monumental (5)" },
    { value: "6", label: "Titanic (6)" },
];

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
                    <span>{`+${s.bonus}`}</span>
                </div>
            ))}
        </div>
    );
}

/**
 * Keeps the raw roll of the last initiative: the room answers a roll of the
 * "Initiative" label with a chat message of this character, and its total
 * less the current modifier is stored.
 */
function useLastInitiative() {
    const { actions } = useSheet();
    useEffect(() => {
        const pending = new Set<string>();
        const characterName = () => String(peekAt("characterInfo.characterName") ?? "").trim();

        const onRoll = (e: Event) => {
            if ((e as CustomEvent).detail?.label !== "Initiative") return;
            const name = characterName();
            if (name) pending.add(name);
        };
        const onChat = (e: Event) => {
            const { characterName: name, commandResult } = (e as CustomEvent).detail ?? {};
            if (!name || !commandResult || !pending.has(name)) return;
            const totalMatch = String(commandResult).match(/=\s*(-?\d+)\s*$/);
            if (!totalMatch) return;
            pending.delete(name);
            const raw = parseInt(totalMatch[1], 10) - (Number(peekAt("initiative.modifier")) || 0);
            actions.change("initiative.lastInitiative", raw);
        };

        document.addEventListener("sheet:rollExact", onRoll);
        document.addEventListener("ws:chatMessage", onChat);
        return () => {
            document.removeEventListener("sheet:rollExact", onRoll);
            document.removeEventListener("ws:chatMessage", onChat);
        };
    }, [actions]);
}

function LastInitiative() {
    const raw = Number(valueAt("initiative.lastInitiative")) || 0;
    const modifier = Number(valueAt("initiative.modifier")) || 0;
    const total = raw + modifier;
    const title = raw ? `Roll: ${raw}, Modifiers: ${modifier >= 0 ? "+" : ""}${modifier}, Total: ${total}` : undefined;
    return (
        <span id="initiativeResult" class={raw ? "has-result" : undefined} title={title}>
            <span class="initiative-label">Latest initiative:</span>
            <span id="lastInitiativeDisplay">{raw ? String(total) : ""}</span>
        </span>
    );
}

export function InitiativeAndSize() {
    const open = useSignal(false);
    const wrapper = useRef<HTMLDivElement>(null);
    useDismiss(wrapper, open.value, () => { open.value = false; });
    useLastInitiative();
    const roll = String(valueAt("initiative.initiative") ?? "");

    return (
        <>
            <div class="layout-column">
                <h3>Initiative</h3>
                <div class="initiative-wrapper" ref={wrapper}>
                    <div class="layout-row content-center">
                        <label class="rollable" onClick={() => { if (roll.trim()) rollExact(roll.trim(), "Initiative"); }}>Initiative:</label>
                        <input
                            class="short-input uneditable textlike"
                            id="initiativeRoll"
                            type="text"
                            readOnly
                            tabIndex={-1}
                            value={roll}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => { open.value = true; }}
                        />
                        <button
                            class={open.value ? "initiative-dropdown-toggle active" : "initiative-dropdown-toggle"}
                            type="button"
                            onClick={() => { open.value = !open.value; }}
                        >
                            {open.value ? "▲" : "▼"}
                        </button>
                    </div>
                    <Scope dataId="initiative" class={open.value ? "initiative-dropdown visible" : "initiative-dropdown"}>
                        <div class="layout-row">
                            <label>
                                Dice:<TextField field="dice" class="short-input" />
                            </label>
                        </div>
                        <fieldset>
                            <legend>Characteristic Bases</legend>
                            {BASES.map((row, i) => (
                                <div key={i} class="layout-row">
                                    {row.map(([field, label]) => (
                                        <label key={field}><Checkbox field={field} class="custom" /> {label}</label>
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
                <Select field="size" options={SIZES} />
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
        `${entry.name?.value || "?"}: +${resolveStackExpr(entry.movementBonus?.value as string, stacks)}`);
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
