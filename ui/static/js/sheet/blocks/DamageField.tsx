// The damage of an attack or melee profile with its modifiers (damage.ts): the
// row shows what is rolled; a click on it or the toggle next to it opens the
// dropdown with the weapon's own damage and the modifiers.
import { useEffect, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { untracked } from "@preact/signals-core";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, ReadonlyField, TextField, valueAt } from "../components/fields";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { SuggestField, useQueryAtCaret } from "../components/SuggestField";
import { TextMarks } from "../components/TextMarks";
import { useItemIds } from "../components/useItemIds";
import { addedBy, parseDamage } from "../damage";
import { damageAt, damageKeys, damageModsAt, damageModsGrid, damageRefValue, damageSources } from "../state/damage";
import { damageSuggestions, insertTerm, termAt, termParts } from "../state/damageSuggestions";
import { rollDamage } from "./rollParts";

const EXPR_TITLE = [
    "What the modifier adds to the damage:",
    "S.b — the bonus of a characteristic",
    "½WS.b, 1/2 WS.b, 0.5WS.b — a part of it, rounded down; ½WS.b▲ rounds up",
    "2×bPR — twice the base psy rating",
    "2, -1 — a number",
    "1d10 — dice; the base's dice of the same sides add up",
    "S.b+2 — several at once",
    "Case does not matter. An unknown term turns the modifier off.",
].join("\n");

/**
 * The expression of a modifier, with suggestions for the term being typed.
 * While a term reads as nothing, the field is outlined and that term marked;
 * not the term being typed while it may still become one, e.g. "W" of WS.b.
 */
function ExprField({ path }: { path: string }) {
    const { stats } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);
    const expr = String(valueAt(`${path}.expr`) ?? "");
    const typing = useQueryAtCaret(inputRef, termAt);
    const unfinished = typing !== null && damageSuggestions(stats.characteristics, typing, damageRefValue).length > 0;
    const invalid = parseDamage(expr, damageKeys()).invalid.filter(t => !(unfinished && t === typing));
    return (
        <span class="damage-expr-wrap">
            <SuggestField inputRef={inputRef} field="expr" class={invalid.length ? "damage-expr invalid" : "damage-expr"}
                placeholder="S.b, ½WS.b, 1d5"
                title={invalid.length ? `Unknown: ${invalid.join(", ")}. The modifier is off.\n\n${EXPR_TITLE}` : EXPR_TITLE}
                suggest={query => damageSuggestions(stats.characteristics, query, damageRefValue)}
                queryAt={termAt} insert={insertTerm} />
            {invalid.length > 0 && <TextMarks inputRef={inputRef} parts={termParts(expr, invalid)} />}
        </span>
    );
}

function DamageMod({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const added = useComputed(() => {
        const { terms, invalid } = parseDamage(String(valueAt(`${path}.expr`) ?? ""), damageKeys());
        return invalid.length || terms.length === 0 ? "—" : addedBy(terms, damageRefValue);
    });
    const enabled = !!valueAt(`${path}.enabled`);
    return (
        <Scope dataId={itemId} class={enabled ? "damage-mod" : "damage-mod disabled"}>
            <Checkbox field="enabled" class="custom" title="Counts in the damage" />
            <ExprField path={path} />
            <TextField field="name" class="damage-mod-name" placeholder="Name" />
            <span class="damage-mod-added" data-id="added">{added}</span>
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/**
 * Replaces the modifiers of the damage at `path` with those of another
 * attack or melee profile of the sheet, under new ids. The pick is an
 * action, so the select always shows its prompt.
 */
function CopyFrom({ path }: { path: string }) {
    const { canEdit, actions } = useSheet();
    const sources = damageSources(path);
    const copy = (from: string) => actions.batch(path, { damageMods: damageModsGrid(untracked(() => damageModsAt(from))) });
    return (
        <select class="damage-copy" title="Replace the modifiers with those of another weapon" disabled={!canEdit || sources.length === 0}
            onChange={e => {
                const from = e.currentTarget.value;
                e.currentTarget.value = "";
                if (from) copy(from);
            }}>
            <option value="">{sources.length ? "Copy from…" : "Nothing to copy"}</option>
            {(["Melee", "Ranged"] as const).map(group => {
                const inGroup = sources.filter(s => s.group === group);
                return inGroup.length > 0 && (
                    <optgroup key={group} label={group}>
                        {inGroup.map(s => (
                            <option key={s.path} value={s.path}>{`${s.label}: ${s.mods.map(m => m.name.trim() || m.expr.trim()).join(", ")}`}</option>
                        ))}
                    </optgroup>
                );
            })}
        </select>
    );
}

/**
 * The damage field of the attack or melee profile at the enclosing path,
 * whose rolls go by `label`.
 */
export function DamageField({ label }: { label: () => string }) {
    const path = usePath();
    const ref = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLInputElement>(null);
    const dropdown = useDropdown(ref);
    const damage = useComputed(() => damageAt(path));
    const text = useComputed(() => damage.value.text);
    const hasMods = useItemIds(`${path}.damageMods.items`).ids.length > 0;
    const { parts, parsed } = damage.value;
    const base = String(valueAt(`${path}.damage`) ?? "").trim();

    // A click on the total opens the dropdown at the weapon's own damage.
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

    const toggleClass = ["damage-toggle", hasMods && "has-mods", dropdown.open && "active"].filter(Boolean).join(" ");
    return (
        <div class="damage-field dropdown-parent" ref={ref}>
            <ReadonlyField field="damageTotal" value={text} class="damage-total"
                title={parts.length ? [`Weapon ${base}`, ...parts].join("\n") : undefined} onClick={editBase} />
            <button type="button" class={toggleClass} title="Damage modifiers" onClick={dropdown.toggle}>
                {dropdown.open ? "▲" : "▼"}
            </button>
            {/* Rendered only while open: a dropdown per weapon would hold a sortable grid each. */}
            {dropdown.open && (
                <div class="roll-dropdown damage-dropdown visible">
                    <label class="damage-base" title="The weapon's own damage, as the rulebook gives it">
                        <span class="column-label">Weapon</span>
                        <TextField field="damage" inputRef={baseRef} placeholder="1d10+2" />
                    </label>
                    <div class="damage-mods-header">
                        <span class="column-label">Modifiers</span>
                        <CopyFrom path={path} />
                    </div>
                    {!hasMods && <p class="damage-hint">Add S.b, ½WS.b, 1d5 or a number to the weapon's damage.</p>}
                    <ItemGrid dataId="damageMods.items" class="damage-mods" itemClass="damage-mod" idPrefix="damage-mod"
                        renderItem={id => <DamageMod itemId={id} />} />
                    {hasMods && base && !parsed && (
                        <p class="damage-note">The weapon's damage is no dice expression: the modifiers do not count.</p>
                    )}
                    <div class="damage-result">
                        <span class="column-label">Total</span>
                        <span class="damage-result-value" data-id="result">{text}</span>
                        <button type="button" data-id="rollButton" disabled={!damage.value.expression}
                            onClick={() => rollDamage(path, label())}>Roll</button>
                    </div>
                </div>
            )}
        </div>
    );
}
