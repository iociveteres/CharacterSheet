// The grip row of a melee weapon: its grips as chips (state/grips.ts), the
// one held framed, ✎ to edit the grip string in place; the Balance after
// them. Range and Balance show their total with a ⚙ whose window holds the
// weapon's own value and what changed it (state/melee.ts).
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useComputed } from "@preact/signals";
import type { ReadonlySignal } from "@preact/signals-core";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, ReadonlyField, TextField } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { useItemIds } from "../components/useItemIds";
import { signed } from "../system";
import { WEAPON_DAMAGE } from "../state/damage";
import { damageSuggestions } from "../state/damageSuggestions";
import { gripTitle } from "../state/grips";
import { balanceAt, heldGrip, meleeRangeAt, meleeRollName, type BreakdownLine } from "../state/melee";
import { parryAt, parryBonusSuccesses, parryModValue } from "../state/parry";
import { peekAt, textAt, valueAt } from "../state/sync";
import { ExprInput } from "./ModdedField";

/** What a breakdown shows: the value's own base, the lines that changed it and the total. */
export interface Breakdown {
    /** The base and whose it is, for a value a field of the weapon holds. */
    base?: string;
    own?: string;
    lines: BreakdownLine[];
    text: string;
}

/** The lines of `value`'s breakdown: a base not the weapon's own is the first, as "= 3 Mace". */
const linesOf = ({ base, own, lines }: Breakdown): BreakdownLine[] =>
    (!own || own === "Weapon" ? lines : [{ text: `= ${base}`, label: `${own} (Mh)` }, ...lines]);

/** The title of a total: the weapon's own value, what changed it and the total; none while nothing did. */
export function breakdownTitle(value: Breakdown, ownTyped: string): string {
    const lines = linesOf(value);
    if (!lines.length) return "";
    return [`${ownTyped || "—"} Weapon`, ...lines.map(l => `${l.text} ${l.label}`), `= ${value.text}`].join("\n");
}

/** The lines of a breakdown and its total, as a grid of value and label. */
export function BreakdownLines({ lines, total }: { lines: BreakdownLine[]; total: string }) {
    return (
        <div class="breakdown" data-id="breakdown">
            {lines.map((l, i) => [<span key={`v${i}`} class="breakdown-value">{l.text}</span>, <span key={`l${i}`} class="breakdown-label">{l.label}</span>])}
            <span class="breakdown-value breakdown-total" data-id="result">{total}</span>
            <span class="breakdown-label breakdown-total" />
        </div>
    );
}

/**
 * A total with a ⚙ joined to it whose window shows the weapon's own value in
 * `baseField`, editable there, the lines that changed it and the total. A
 * click on the total opens the window at the weapon's own value.
 */
export function BreakdownField({ field, baseField, value, title, toggleTitle, placeholder = "", class: cls, dropdownClass, totalClass, children }: {
    field: string;
    /** The weapon's own value, edited in the window; none for a value of no field of its own, as Parry. */
    baseField?: string;
    value: ReadonlySignal<Breakdown>;
    title: string;
    toggleTitle: string;
    placeholder?: string;
    class?: string;
    /** Classes of the window, as "open-right". */
    dropdownClass?: string;
    /** Classes of the total, as "dimmed". */
    totalClass?: string;
    /** Rows under the breakdown, as Parry's modifiers. */
    children?: ComponentChildren;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLInputElement>(null);
    const dropdown = useDropdown(ref);
    const text = useComputed(() => value.value.text);

    const focusBase = useRef(false);
    useEffect(() => {
        if (!dropdown.open) return;
        if (focusBase.current) baseRef.current?.focus();
        focusBase.current = false;
    }, [dropdown.open]);
    const editBase = () => {
        focusBase.current = true;
        if (dropdown.open) baseRef.current?.focus();
        else dropdown.show();
    };

    return (
        <div class={cls ? `mod-field dropdown-parent ${cls}` : "mod-field dropdown-parent"} ref={ref}>
            <ReadonlyField field={field} value={text} class={totalClass ? `mod-total ${totalClass}` : "mod-total"} onClick={editBase} title={title} />
            <button type="button" class={dropdown.open ? "mod-toggle active" : "mod-toggle"} title={toggleTitle} onClick={dropdown.toggle}>⚙</button>
            {dropdown.open && (
                <div class={`roll-dropdown mod-dropdown breakdown-dropdown visible${dropdownClass ? ` ${dropdownClass}` : ""}`}>
                    {baseField && (
                        <label class="mod-base" title="The weapon's own value, as the rulebook gives it">
                            <span class="column-label">Weapon</span>
                            <TextField field={baseField} inputRef={baseRef} placeholder={placeholder} />
                        </label>
                    )}
                    <BreakdownLines lines={linesOf(value.value)} total={value.value.text} />
                    {children}
                </div>
            )}
        </div>
    );
}

/** The Range of the melee profile at the enclosing path; its window opens to the right, as the field is the first of its row. */
export function MeleeRangeField() {
    const { state } = useSheet();
    const path = usePath();
    const range = useComputed(() => meleeRangeAt(state, path));
    const own = String(peekAt(state, `${path}.range`) ?? "");
    return (
        <BreakdownField field="rangeTotal" baseField="range" value={range} title={breakdownTitle(range.value, own)}
            toggleTitle="Rng of the weapon and what changes it" placeholder="2-4" dropdownClass="open-right" />
    );
}

/** The Balance of the melee attack at `attackPath`. */
function BalanceField({ attackPath }: { attackPath: string }) {
    const { state } = useSheet();
    const balance = useComputed(() => balanceAt(state, attackPath));
    const own = String(peekAt(state, `${attackPath}.balance`) ?? "");
    return (
        <BreakdownField field="balanceTotal" baseField="balance" value={balance} title={breakdownTitle(balance.value, own)}
            toggleTitle="Balance of the weapon and what changes it" placeholder="0" />
    );
}

/**
 * The grips of the melee attack at `attackPath` as chips; a click holds one.
 * ✎ edits the grip string in place: Enter or leaving it closes it, Esc puts
 * back what it was. The chips squeeze rather than push the next fields of
 * the row to another line.
 */
function GripChips({ attackPath }: { attackPath: string }) {
    const { state, actions, canEdit } = useSheet();
    const grip = useComputed(() => heldGrip(state, attackPath)).value;
    const [editing, setEditing] = useState(false);
    const before = useRef("");
    const inputRef = useRef<HTMLInputElement>(null);
    const chipsRef = useRef<HTMLSpanElement>(null);
    const path = joinPath(attackPath, "grip");

    useLayoutEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    // Squeezed while the chips at their full size overflow their place; the
    // class is the DOM's alone, so a render does not take it off.
    const ids = grip.grips.map(g => g.id).join(" ");
    useLayoutEffect(() => {
        const el = chipsRef.current;
        if (!el) return;
        const measure = () => {
            el.classList.remove("squeezed");
            el.classList.toggle("squeezed", el.scrollWidth > el.clientWidth + 1);
        };
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(el.parentElement ?? el);
        return () => observer.disconnect();
    }, [ids, editing]);

    const open = () => {
        before.current = String(peekAt(state, path) ?? "");
        setEditing(true);
    };
    const hold = (id: string) => actions.change(joinPath(attackPath, "gripSelected"), id === grip.grips[0]?.id ? "" : id);

    if (editing) {
        return (
            <TextField field="grip" inputRef={inputRef} class="grip-input" placeholder="2р [1р, Бл] or 2h [1h, Cl]"
                title="The grips of the weapon: the primary, then the alternatives in brackets; + joins grips"
                onBlur={() => setEditing(false)}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        // The sheet's Enter would move to the next field.
                        e.stopPropagation();
                        setEditing(false);
                    } else if (e.key === "Escape") {
                        actions.change(path, before.current);
                        setEditing(false);
                    }
                }} />
        );
    }
    return (
        <>
            <span class="grip-chips" ref={chipsRef} data-id="gripChips">
                {grip.grips.map((g, i) => (
                    <button key={g.id} type="button" class={g === grip.held ? "grip-chip selected" : "grip-chip"} disabled={!canEdit}
                        title={i === 0 ? `Primary grip\n${gripTitle(g)}` : gripTitle(g)} onClick={() => hold(g.id)}>{g.id}</button>
                ))}
            </span>
            {canEdit && <button type="button" class="grip-edit" title="Edit the grips of the weapon" onClick={open}>✎</button>}
        </>
    );
}

const PARRY_EXPR_TITLE = [
    "What the modifier adds to a Parry with the weapon:",
    "3×bPR — three times the base psy rating",
    "S.b, ½WS.b — the bonus of a characteristic, or a part of it",
    "10, -5 — a number",
    "Dice do not count. An unknown term turns the modifier off.",
].join("\n");

function ParryModRow({ itemId, attackPath }: { itemId: string; attackPath: string }) {
    const { state, stats } = useSheet();
    const path = joinPath(usePath(), itemId);
    const added = useComputed(() => parryModValue(state, attackPath, textAt(state, `${path}.expr`))).value;
    const enabled = !!valueAt(state, `${path}.enabled`);
    const { keys, named, valueOf } = WEAPON_DAMAGE.refs(state, attackPath);
    return (
        <Scope dataId={itemId} class={enabled ? "weapon-mod" : "weapon-mod disabled"}>
            <Checkbox field="enabled" class="custom" title="Counts in the Parry" />
            <ExprInput path={path} keys={keys} named={named} placeholder="3×bPR, 10" title={PARRY_EXPR_TITLE}
                suggest={query => damageSuggestions(stats.characteristics, query, valueOf, named)} />
            <span class="mod-added" data-id="added">{added === null ? "—" : signed(added)}</span>
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/**
 * Parry with the melee attack at `attackPath`: "Parry:" rolls it; the total's
 * ⚙ breaks it down and holds the weapon's modifiers. At Balance −2 the
 * weapon cannot parry: dimmed, "—", but it still rolls.
 */
function ParryField({ attackPath }: { attackPath: string }) {
    const { state, rolls, preview } = useSheet();
    const parry = useComputed(() => parryAt(state, attackPath));
    const { canParry, lines, text } = parry.value;
    const hasMods = useItemIds(`${attackPath}.parryMods.items`).ids.length > 0;
    const title = canParry ? [...lines.map(l => `${l.text} ${l.label}`), `= ${text}`].join("\n") : "Balance -2: this weapon cannot parry";
    const roll = () => {
        const { value } = parry.peek();
        const name = String(peekAt(state, `${attackPath}.name`) || "Melee Attack");
        void rolls.versus(value, parryBonusSuccesses(state), `${meleeRollName(state, attackPath, name)}, Parry`);
    };
    const dim = canParry ? undefined : "dimmed";
    return (
        <div class="layout-row parry">
            {preview
                ? <label class={dim}>Parry:</label>
                : <label class={canParry ? "rollable" : "rollable dimmed"} title={canParry ? "Roll Parry with this weapon" : title} onClick={roll}>Parry:</label>}
            <BreakdownField field="parryTotal" value={parry} title={title} toggleTitle="Parry with this weapon and its modifiers" totalClass={dim}>
                <div class="mods-header">
                    <span class="column-label">Modifiers</span>
                </div>
                {!hasMods && <p class="mod-hint">Add 3×bPR, 10 or -5.</p>}
                <ItemGrid dataId="parryMods.items" class="weapon-mods" itemClass="weapon-mod" idPrefix="parry-mod"
                    renderItem={id => <ParryModRow itemId={id} attackPath={attackPath} />} />
            </BreakdownField>
        </div>
    );
}

/** The row of the grips and the Balance of the melee attack at `attackPath`; `children` come after them, as Parry. */
export function GripRow({ attackPath, children }: { attackPath: string; children?: ComponentChildren }) {
    return (
        <div class="layout-row grip-row">
            <div class="layout-row grip">
                <label>Grip:</label>
                <GripChips attackPath={attackPath} />
            </div>
            <div class="layout-row balance">
                <label>Balance:</label>
                <BalanceField attackPath={attackPath} />
            </div>
            <ParryField attackPath={attackPath} />
            {children}
        </div>
    );
}
