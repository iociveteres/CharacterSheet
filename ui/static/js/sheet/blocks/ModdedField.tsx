// The damage or penetration of an attack, melee profile or psychic power with
// its modifiers (damage.ts): the row shows the total; a click on it or the
// gear next to it opens the dropdown with the item's own value and the
// modifiers. A power's also holds the PR of its last cast, which PR counts.
// The block names the owner of the item: WEAPON_FIELD or POWER_FIELD.
import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { untracked } from "@preact/signals-core";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField, ReadonlyField, TextField } from "../components/fields";
import { textAt, valueAt } from "../state/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { SuggestField, useQueryAtCaret } from "../components/SuggestField";
import { TextMarks } from "../components/TextMarks";
import { useItemIds } from "../components/useItemIds";
import { parseDamage } from "../damage";
import {
    POWER_DAMAGE, WEAPON_DAMAGE, modAddedAt, modsAt, modsGrid, powerPR, statAt, type DamageOwner, type WeaponStat,
} from "../state/damage";
import { damageSuggestions, insertTerm, termAt, termParts } from "../state/damageSuggestions";
import { castCap } from "../state/psychic";

const STAT_NOUNS: { [S in WeaponStat]: string } = { damage: "damage", pen: "penetration" };

/** How the field of an owner of modified damage reads (state/damage.ts DamageOwner). */
export interface FieldOwner {
    damage: DamageOwner;
    /** The item in the texts, "weapon" or "power", and its label in the dropdown. */
    noun: string;
    label: string;
    stats: { [S in WeaponStat]: { own: string; placeholder: string; hint: string } };
    exprPlaceholder: string;
    /** Help lines on the references only its expressions hold. */
    exprHelp: string[];
    /** The first line of the total's title: the item's own value. */
    own(path: string, base: string): string;
    /** Whether the total has a title without modifiers too. */
    explainsOwn: boolean;
    /** A row under the item's own value. */
    Extra?: (props: { path: string }) => JSX.Element;
}

export const WEAPON_FIELD: FieldOwner = {
    damage: WEAPON_DAMAGE,
    noun: "weapon",
    label: "Weapon",
    stats: {
        damage: { own: "The weapon's own damage, as the rulebook gives it", placeholder: "1d10+2", hint: "Add S.b, ½WS.b, 1d5 or a number." },
        pen: { own: "The weapon's own penetration, as the rulebook gives it", placeholder: "4", hint: "Add ½S.b, bPR or a number." },
    },
    exprPlaceholder: "S.b, ½WS.b, 1d5",
    exprHelp: [],
    own: (_, base) => `Weapon ${base}`,
    explainsOwn: false,
};

export const POWER_FIELD: FieldOwner = {
    damage: POWER_DAMAGE,
    noun: "power",
    label: "Power",
    stats: {
        damage: {
            own: "The power's own damage, as the rulebook gives it; PR is the PR of its cast",
            placeholder: "1d10+2×PR",
            hint: "Add W.b, PR, 1d10 or a number.",
        },
        pen: {
            own: "The power's own penetration, as the rulebook gives it; PR is the PR of its cast",
            placeholder: "PR",
            hint: "Add PR, bPR or a number.",
        },
    },
    exprPlaceholder: "PR, W.b, 1d10",
    exprHelp: ["PR — the PR of the cast; PRd10 — d10 as many"],
    own: (path, base) => `Power ${base}, PR ${powerPR(path)}`,
    // The total counts the PR even without modifiers.
    explainsOwn: true,
    Extra: CastPR,
};

const exprTitle = (noun: string, owner: FieldOwner) => [
    `What the modifier adds to the ${noun}:`,
    "S.b — the bonus of a characteristic",
    "½WS.b, 1/2 WS.b, 0.5WS.b — a part of it, rounded down; ½WS.b▲ rounds up",
    "2×bPR — twice the base psy rating",
    ...owner.exprHelp,
    "2, -1 — a number",
    "1d10 — dice; the base's dice of the same sides add up",
    "S.b+2 — several at once",
    "Case does not matter. An unknown term turns the modifier off.",
].join("\n");

/**
 * The expression of a modifier of the item at `itemPath`, with suggestions
 * for the term being typed. While a term reads as nothing, the field is
 * outlined and that term marked; not the term being typed while it may still
 * become one, e.g. "W" of WS.b.
 */
function ExprField({ path, itemPath, noun, owner }: { path: string; itemPath: string; noun: string; owner: FieldOwner }) {
    const { stats } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);
    const expr = String(valueAt(`${path}.expr`) ?? "");
    const { keys, named, valueOf } = owner.damage.refs(itemPath);
    const suggest = (query: string | null) => damageSuggestions(stats.characteristics, query, valueOf, named);
    const typing = useQueryAtCaret(inputRef, termAt);
    const unfinished = typing !== null && suggest(typing).length > 0;
    const invalid = parseDamage(expr, keys, named).invalid.filter(t => !(unfinished && t === typing));
    const title = exprTitle(noun, owner);
    return (
        <span class="mod-expr-wrap">
            <SuggestField inputRef={inputRef} field="expr" class={invalid.length ? "mod-expr invalid" : "mod-expr"}
                placeholder={owner.exprPlaceholder}
                title={invalid.length ? `Unknown: ${invalid.join(", ")}. The modifier is off.\n\n${title}` : title}
                suggest={suggest} queryAt={termAt} insert={insertTerm} />
            {invalid.length > 0 && <TextMarks inputRef={inputRef} parts={termParts(expr, invalid)} />}
        </span>
    );
}

function ModRow({ itemId, itemPath, noun, owner }: { itemId: string; itemPath: string; noun: string; owner: FieldOwner }) {
    const path = joinPath(usePath(), itemId);
    const added = useComputed(() => modAddedAt(owner.damage, itemPath, textAt(`${path}.expr`)));
    const enabled = !!valueAt(`${path}.enabled`);
    return (
        <Scope dataId={itemId} class={enabled ? "weapon-mod" : "weapon-mod disabled"}>
            <Checkbox field="enabled" class="custom" title={`Counts in the ${noun}`} />
            <ExprField path={path} itemPath={itemPath} noun={noun} owner={owner} />
            <span class="mod-added" data-id="added">{added}</span>
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/**
 * Replaces the modifiers of `stat` at `path` with those of another item of
 * the sheet of its kind, under new ids. The pick is an action, so the select
 * always shows its prompt.
 */
function CopyFrom({ path, stat, owner }: { path: string; stat: WeaponStat; owner: FieldOwner }) {
    const { canEdit, actions } = useSheet();
    const sources = owner.damage.sources(path, stat);
    const groups = [...new Set(sources.map(s => s.group))];
    const copy = (from: string) => actions.batch(path, { [`${stat}Mods`]: modsGrid(untracked(() => modsAt(from, stat)), stat) });
    return (
        <select class="mod-copy" title={`Replace the modifiers with those of another ${owner.noun}`} disabled={!canEdit}
            onChange={e => {
                const from = e.currentTarget.value;
                e.currentTarget.value = "";
                if (from) copy(from);
            }}>
            <option value="">Copy from…</option>
            {sources.length === 0 && <option value="" disabled>{`No other ${owner.noun} has modifiers`}</option>}
            {groups.map(group => (
                <optgroup key={group} label={group}>
                    {sources.filter(s => s.group === group).map(s => (
                        <option key={s.path} value={s.path}>{`${s.label}: ${s.mods.map(m => m.expr.trim()).join(", ")}`}</option>
                    ))}
                </optgroup>
            ))}
        </select>
    );
}

/**
 * The PR a power's damage and penetration count: that of its last cast,
 * which can be lowered here; the next cast sets it again.
 */
function CastPR({ path }: { path: string }) {
    const cast = Number(valueAt(`${path}.cast.pr`)) || 0;
    const kick = Number(valueAt(`${path}.cast.kick`)) || 0;
    const cap = useComputed(() => castCap(path)).value;
    const note = cast <= 0 ? `No cast yet: PR ${cap} counts`
        : valueAt(`${path}.cast.safe`) ? "Of the last cast, safe"
            : kick > 0 ? `Of the last cast, +${kick} kick` : "Of the last cast";
    return (
        <label class="mod-base mod-pr" title="The PR the damage and penetration count. Lower it for this hit; the next cast sets it again.">
            <span class="column-label">PR</span>
            <Scope dataId="cast" as="span" class="mod-pr-field">
                <NumberField field="pr" />
            </Scope>
            <span class="mod-pr-note" data-id="prNote">{note}</span>
        </label>
    );
}

/** The field of `stat` of the item of `owner` at the enclosing path. */
export function ModdedField({ stat, owner }: { stat: WeaponStat; owner: FieldOwner }) {
    const path = usePath();
    const texts = owner.stats[stat];
    const noun = STAT_NOUNS[stat];
    const ref = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLInputElement>(null);
    const dropdown = useDropdown(ref);
    const resolved = useComputed(() => statAt(owner.damage, path, stat));
    const text = useComputed(() => resolved.value.text);
    const hasMods = useItemIds(`${path}.${stat}Mods.items`).ids.length > 0;
    const { parts, parsed } = resolved.value;
    const base = String(valueAt(`${path}.${stat}`) ?? "").trim();
    const title = parts.length || (owner.explainsOwn && parsed) ? [owner.own(path, base), ...parts].join("\n") : undefined;

    // A click on the total opens the dropdown at the item's own value.
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
            <ReadonlyField field={`${stat}Total`} value={text} class="mod-total" title={title} onClick={editBase} />
            <button type="button" class={dropdown.open ? "mod-toggle active" : "mod-toggle"} title={`Modifiers of the ${noun}`}
                onClick={dropdown.toggle}>⚙</button>
            {/* Rendered only while open: a dropdown per item would hold a sortable grid each. */}
            {dropdown.open && (
                <div class="roll-dropdown mod-dropdown visible">
                    <label class="mod-base" title={texts.own}>
                        <span class="column-label">{owner.label}</span>
                        <TextField field={stat} inputRef={baseRef} placeholder={texts.placeholder} />
                    </label>
                    {owner.Extra && <owner.Extra path={path} />}
                    <div class="mods-header">
                        <span class="column-label">Modifiers</span>
                        <CopyFrom path={path} stat={stat} owner={owner} />
                    </div>
                    {!hasMods && <p class="mod-hint">{texts.hint}</p>}
                    <ItemGrid dataId={`${stat}Mods.items`} class="weapon-mods" itemClass="weapon-mod" idPrefix={`${stat}-mod`}
                        renderItem={id => <ModRow itemId={id} itemPath={path} noun={noun} owner={owner} />} />
                    {hasMods && base && !parsed && (
                        <p class="mod-note">{`The ${owner.noun}'s ${noun} is no expression: the modifiers do not count.`}</p>
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
