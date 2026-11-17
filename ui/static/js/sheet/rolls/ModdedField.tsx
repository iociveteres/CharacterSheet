// The damage or penetration of an attack, melee profile, psychic or tech power
// with its modifiers (damage.ts): the row shows the total; a click on it or
// the gear next to it opens the dropdown with the item's own value and the
// modifiers. A psychic power's also holds the PR of its last cast, which PR
// counts. The block names the owner of the item: WEAPON_FIELD (weaponDamage.ts),
// POWER_FIELD (Powers.tsx) or TECH_FIELD (techDamage.ts).
import type { JSX, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { untracked, type ReadonlySignal } from "@preact/signals-core";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { hoverTitle } from "../components/hoverTitle";
import { Checkbox, ReadonlyField, TextField } from "../components/fields";
import { textAt, valueAt } from "../core/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { SuggestField, useQueryAtCaret, type SuggestionGroup } from "../components/SuggestField";
import { TextMarks } from "../components/TextMarks";
import { useItemIds } from "../components/useItemIds";
import { parseDamage } from "./damageExpression";
import { modAddedAt, modsAt, modsGrid, statAt, type DamageOwner, type StatText, type WeaponStat } from "./damage";
import { damageSuggestions, insertTerm, termAt, termParts } from "./damageSuggestions";
import type { SheetSignals } from "../schema/sheet";
import { t } from "../../i18n";

// Whole phrases per stat: Russian declines the noun ("в уроне", "к урону").
const STAT_TEXTS: { [S in WeaponStat]: { counts: string; mods: string; addsTo: string } } = {
    damage: {
        counts: t("sheet.rolls.modded.damage.counts"),
        mods: t("sheet.rolls.modded.damage.mods"),
        addsTo: t("sheet.rolls.modded.damage.addsTo"),
    },
    pen: {
        counts: t("sheet.rolls.modded.pen.counts"),
        mods: t("sheet.rolls.modded.pen.mods"),
        addsTo: t("sheet.rolls.modded.pen.addsTo"),
    },
};

/** How the field of an owner of modified damage reads (rolls/damage.ts DamageOwner). */
export interface FieldOwner {
    damage: DamageOwner;
    /** The phrases that name the item, whole: Russian would decline its noun. */
    texts: { copyTitle: string; noSources: string; noExpression: { [S in WeaponStat]: string } };
    /** The item's label in the dropdown. */
    label: string;
    stats: { [S in WeaponStat]: { own: string; placeholder: string; hint: string } };
    exprPlaceholder: string;
    /** Help lines on the references only its expressions hold. */
    exprHelp: string[];
    /** The first line of the total's title: the item's own value. */
    own(state: SheetSignals, path: string, base: string): string;
    /** Whether the total has a title without modifiers too. */
    explainsOwn: boolean;
    /** A row under the item's own value. */
    Extra?: (props: { path: string }) => JSX.Element;
    /** What the total does not count but the hit should, as a broken weapon's halving; empty for none. */
    note?: (state: SheetSignals, path: string, stat: WeaponStat) => string;
}

const exprTitle = (stat: WeaponStat, owner: FieldOwner) =>
    [STAT_TEXTS[stat].addsTo, t("sheet.rolls.modded.helpRefs"), ...owner.exprHelp, t("sheet.rolls.modded.helpRest")].join("\n");

/**
 * The expression of the modifier at `path`, or its `field`, with suggestions
 * for the term being typed. While a term reads as nothing, the field is
 * outlined and that term marked; not the term being typed while it may still
 * become one, e.g. "W" of WS.b. `empty`, why the whole reads as nothing,
 * outlines it too; `off` says what that turns off.
 */
export function ExprInput({
    path, field = "expr", inputRef: outerRef, keys, named, suggest, insert = insertTerm, placeholder, title, empty = null, off = t("sheet.rolls.modifierOff"),
}: {
    path: string; field?: string; inputRef?: RefObject<HTMLInputElement>; keys: readonly string[]; named: readonly string[];
    suggest: (query: string | null) => SuggestionGroup[]; placeholder: string; title: string; empty?: string | null; off?: string;
    /** How a picked suggestion goes into the expression; insertTerm by default. */
    insert?: (text: string, caret: number, value: string, typed: boolean) => string;
}) {
    const { state } = useSheet();
    const ownRef = useRef<HTMLInputElement>(null);
    const inputRef = outerRef ?? ownRef;
    const expr = textAt(state, `${path}.${field}`);
    const typing = useQueryAtCaret(inputRef, termAt);
    const unfinished = typing !== null && suggest(typing).length > 0;
    const invalid = parseDamage(expr, keys, named).invalid.filter(t => !(unfinished && t === typing));
    const reason = invalid.length ? t("sheet.rolls.unknownTerms", { terms: invalid.join(", ") }) : unfinished ? null : empty;
    return (
        <span class="mod-expr-wrap">
            <SuggestField inputRef={inputRef} field={field} class={reason ? "mod-expr invalid" : "mod-expr"} placeholder={placeholder}
                title={reason ? `${reason}. ${off}\n\n${title}` : title}
                suggest={suggest} queryAt={termAt} insert={insert} />
            {invalid.length > 0 && <TextMarks inputRef={inputRef} parts={termParts(expr, invalid)} />}
        </span>
    );
}

/** The expression of a modifier of the item at `itemPath`. */
function ExprField({ path, itemPath, stat, owner }: { path: string; itemPath: string; stat: WeaponStat; owner: FieldOwner }) {
    const { state, stats } = useSheet();
    const { keys, named, valueOf } = owner.damage.refs(state, itemPath);
    return (
        <ExprInput path={path} keys={keys} named={named} placeholder={owner.exprPlaceholder} title={exprTitle(stat, owner)}
            suggest={query => damageSuggestions(stats.characteristics, query, valueOf, named)} />
    );
}

function ModRow({ itemId, itemPath, stat, owner }: { itemId: string; itemPath: string; stat: WeaponStat; owner: FieldOwner }) {
    const { state } = useSheet();
    const path = joinPath(usePath(), itemId);
    const added = useComputed(() => modAddedAt(state, owner.damage, itemPath, textAt(state, `${path}.expr`)));
    const enabled = !!valueAt(state, `${path}.enabled`);
    return (
        <Scope dataId={itemId} class={enabled ? "weapon-mod" : "weapon-mod disabled"}>
            <Checkbox field="enabled" class="custom" title={STAT_TEXTS[stat].counts} />
            <ExprField path={path} itemPath={itemPath} stat={stat} owner={owner} />
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
    const { state, canEdit, actions } = useSheet();
    const sources = owner.damage.sources(state, path, stat);
    const groups = [...new Set(sources.map(s => s.group))];
    const copy = (from: string) => actions.batch(path, { [`${stat}Mods`]: modsGrid(untracked(() => modsAt(state, from, stat)), stat) });
    return (
        <select class="mod-copy" title={owner.texts.copyTitle} disabled={!canEdit}
            onChange={e => {
                const from = e.currentTarget.value;
                e.currentTarget.value = "";
                if (from) copy(from);
            }}>
            <option value="">{t("sheet.rolls.modded.copyFrom")}</option>
            {sources.length === 0 && <option value="" disabled>{owner.texts.noSources}</option>}
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
/** The title of the total of `stat` at `path`: the item's own value and what each modifier adds; none without them. */
export function modTitle(state: SheetSignals, owner: FieldOwner, path: string, stat: WeaponStat): string[] {
    const { parts, parsed, own } = statAt(state, owner.damage, path, stat);
    const base = String(valueAt(state, `${path}.${stat}`) ?? "").trim();
    const note = owner.note?.(state, path, stat);
    const explained = parts.length || own || (owner.explainsOwn && parsed) || note;
    return explained ? [own ?? owner.own(state, path, base), ...parts, ...(note ? [note] : [])] : [];
}

/** What each labelled modifier adds, under the item's own value; read only while the dropdown is open. */
function Added({ resolved }: { resolved: ReadonlySignal<StatText> }) {
    const { added } = resolved.value;
    if (!added.length) return null;
    return (
        <div class="breakdown" data-id="added">
            {added.map((l, i) => [
                <span key={`v${i}`} class="breakdown-value">{l.text}</span>,
                <span key={`l${i}`} class="breakdown-label">{l.label}</span>,
            ])}
        </div>
    );
}

/** The field of `stat` of the item of `owner` at the enclosing path. */
export function ModdedField({ stat, owner }: { stat: WeaponStat; owner: FieldOwner }) {
    const { state } = useSheet();
    const path = usePath();
    const texts = owner.stats[stat];
    const ref = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLInputElement>(null);
    const dropdown = useDropdown(ref);
    const resolved = useComputed(() => statAt(state, owner.damage, path, stat));
    const text = useComputed(() => resolved.value.text);
    const hasMods = useItemIds(`${path}.${stat}Mods.items`).ids.length > 0;
    // statAt gives a new object on every run of its inputs: the field reads only
    // what it shows, so it renders again only when that changes.
    const parsed = useComputed(() => resolved.value.parsed).value;
    const base = String(valueAt(state, `${path}.${stat}`) ?? "").trim();
    const note = useComputed(() => owner.note?.(state, path, stat) ?? "").value;

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
            <ReadonlyField field={`${stat}Total`} value={text} class="mod-total" onClick={editBase}
                {...hoverTitle(() => modTitle(state, owner, path, stat))} />
            <button type="button" class={dropdown.open ? "mod-toggle active" : "mod-toggle"} title={STAT_TEXTS[stat].mods}
                onClick={dropdown.toggle}>⚙</button>
            {/* Rendered only while open: a dropdown per item would hold a sortable grid each. */}
            {dropdown.open && (
                <div class="roll-dropdown mod-dropdown visible">
                    <label class="mod-base" title={texts.own}>
                        <span class="column-label">{owner.label}</span>
                        <TextField field={stat} inputRef={baseRef} placeholder={texts.placeholder} />
                    </label>
                    {owner.Extra && <owner.Extra path={path} />}
                    <Added resolved={resolved} />
                    <div class="mods-header">
                        <span class="column-label">{t("sheet.rolls.modifiers")}</span>
                        <CopyFrom path={path} stat={stat} owner={owner} />
                    </div>
                    {!hasMods && <p class="mod-hint">{texts.hint}</p>}
                    <ItemGrid dataId={`${stat}Mods.items`} class="weapon-mods" itemClass="weapon-mod" idPrefix={`${stat}-mod`}
                        renderItem={id => <ModRow itemId={id} itemPath={path} stat={stat} owner={owner} />} />
                    {hasMods && base && !parsed && (
                        <p class="mod-note">{owner.texts.noExpression[stat]}</p>
                    )}
                    <div class="mod-result">
                        <span class="column-label">{t("common.total")}</span>
                        <span class="mod-result-value" data-id="result">{text}</span>
                    </div>
                    {note && <p class="mod-note" data-id="note">{note}</p>}
                </div>
            )}
        </div>
    );
}
