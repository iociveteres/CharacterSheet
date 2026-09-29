// The damage or penetration of an attack or melee profile with its modifiers
// (damage.ts): the row shows the total; a click on it or the gear next to it
// opens the dropdown with the weapon's own value and the modifiers.
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
import { modSources, modsAt, modsGrid, refKeys, refValue, statAt, type WeaponStat } from "../state/damage";
import { damageSuggestions, insertTerm, termAt, termParts } from "../state/damageSuggestions";

const TEXTS: { [S in WeaponStat]: { noun: string; own: string; placeholder: string; hint: string } } = {
    damage: {
        noun: "damage",
        own: "The weapon's own damage, as the rulebook gives it",
        placeholder: "1d10+2",
        hint: "Add S.b, ½WS.b, 1d5 or a number.",
    },
    pen: {
        noun: "penetration",
        own: "The weapon's own penetration, as the rulebook gives it",
        placeholder: "4",
        hint: "Add ½S.b, bPR or a number.",
    },
};

const exprTitle = (noun: string) => [
    `What the modifier adds to the ${noun}:`,
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
function ExprField({ path, noun }: { path: string; noun: string }) {
    const { stats } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);
    const expr = String(valueAt(`${path}.expr`) ?? "");
    const typing = useQueryAtCaret(inputRef, termAt);
    const unfinished = typing !== null && damageSuggestions(stats.characteristics, typing, refValue).length > 0;
    const invalid = parseDamage(expr, refKeys()).invalid.filter(t => !(unfinished && t === typing));
    const title = exprTitle(noun);
    return (
        <span class="mod-expr-wrap">
            <SuggestField inputRef={inputRef} field="expr" class={invalid.length ? "mod-expr invalid" : "mod-expr"}
                placeholder="S.b, ½WS.b, 1d5"
                title={invalid.length ? `Unknown: ${invalid.join(", ")}. The modifier is off.\n\n${title}` : title}
                suggest={query => damageSuggestions(stats.characteristics, query, refValue)}
                queryAt={termAt} insert={insertTerm} />
            {invalid.length > 0 && <TextMarks inputRef={inputRef} parts={termParts(expr, invalid)} />}
        </span>
    );
}

function ModRow({ itemId, noun }: { itemId: string; noun: string }) {
    const path = joinPath(usePath(), itemId);
    const added = useComputed(() => {
        const { terms, invalid } = parseDamage(String(valueAt(`${path}.expr`) ?? ""), refKeys());
        return invalid.length || terms.length === 0 ? "—" : addedBy(terms, refValue);
    });
    const enabled = !!valueAt(`${path}.enabled`);
    return (
        <Scope dataId={itemId} class={enabled ? "weapon-mod" : "weapon-mod disabled"}>
            <Checkbox field="enabled" class="custom" title={`Counts in the ${noun}`} />
            <ExprField path={path} noun={noun} />
            <span class="mod-added" data-id="added">{added}</span>
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/**
 * Replaces the modifiers of `stat` at `path` with those of another attack or
 * melee profile of the sheet, under new ids. The pick is an action, so the
 * select always shows its prompt.
 */
function CopyFrom({ path, stat }: { path: string; stat: WeaponStat }) {
    const { canEdit, actions } = useSheet();
    const sources = modSources(path, stat);
    const copy = (from: string) => actions.batch(path, { [`${stat}Mods`]: modsGrid(untracked(() => modsAt(from, stat)), stat) });
    return (
        <select class="mod-copy" title="Replace the modifiers with those of another weapon" disabled={!canEdit}
            onChange={e => {
                const from = e.currentTarget.value;
                e.currentTarget.value = "";
                if (from) copy(from);
            }}>
            <option value="">Copy from…</option>
            {sources.length === 0 && <option value="" disabled>No other weapon has modifiers</option>}
            {(["Melee", "Ranged"] as const).map(group => {
                const inGroup = sources.filter(s => s.group === group);
                return inGroup.length > 0 && (
                    <optgroup key={group} label={group}>
                        {inGroup.map(s => (
                            <option key={s.path} value={s.path}>{`${s.label}: ${s.mods.map(m => m.expr.trim()).join(", ")}`}</option>
                        ))}
                    </optgroup>
                );
            })}
        </select>
    );
}

/** The field of `stat` of the attack or melee profile at the enclosing path. */
export function ModdedField({ stat }: { stat: WeaponStat }) {
    const path = usePath();
    const texts = TEXTS[stat];
    const ref = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLInputElement>(null);
    const dropdown = useDropdown(ref);
    const resolved = useComputed(() => statAt(path, stat));
    const text = useComputed(() => resolved.value.text);
    const hasMods = useItemIds(`${path}.${stat}Mods.items`).ids.length > 0;
    const { parts, parsed } = resolved.value;
    const base = String(valueAt(`${path}.${stat}`) ?? "").trim();

    // A click on the total opens the dropdown at the weapon's own value.
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
        <div class="mod-field dropdown-parent" ref={ref}>
            <ReadonlyField field={`${stat}Total`} value={text} class="mod-total"
                title={parts.length ? [`Weapon ${base}`, ...parts].join("\n") : undefined} onClick={editBase} />
            <button type="button" class={dropdown.open ? "mod-toggle active" : "mod-toggle"} title={`Modifiers of the ${texts.noun}`}
                onClick={dropdown.toggle}>⚙</button>
            {/* Rendered only while open: a dropdown per weapon would hold a sortable grid each. */}
            {dropdown.open && (
                <div class="roll-dropdown mod-dropdown visible">
                    <label class="mod-base" title={texts.own}>
                        <span class="column-label">Weapon</span>
                        <TextField field={stat} inputRef={baseRef} placeholder={texts.placeholder} />
                    </label>
                    <div class="mods-header">
                        <span class="column-label">Modifiers</span>
                        <CopyFrom path={path} stat={stat} />
                    </div>
                    {!hasMods && <p class="mod-hint">{texts.hint}</p>}
                    <ItemGrid dataId={`${stat}Mods.items`} class="weapon-mods" itemClass="weapon-mod" idPrefix={`${stat}-mod`}
                        renderItem={id => <ModRow itemId={id} noun={texts.noun} />} />
                    {hasMods && base && !parsed && (
                        <p class="mod-note">{`The weapon's ${texts.noun} is no expression: the modifiers do not count.`}</p>
                    )}
                    <div class="mod-result">
                        <span class="column-label">Total</span>
                        <span class="mod-result-value" data-id="result">{text}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
