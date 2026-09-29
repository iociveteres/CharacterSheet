// The damage or penetration of an attack, melee profile or psychic power with
// its modifiers (damage.ts): the row shows the total; a click on it or the
// gear next to it opens the dropdown with the item's own value and the
// modifiers. A power's also holds the PR of its last cast, which PR counts.
import { useEffect, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { untracked } from "@preact/signals-core";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField, ReadonlyField, TextField } from "../components/fields";
import { valueAt } from "../state/sync";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { SuggestField, useQueryAtCaret } from "../components/SuggestField";
import { TextMarks } from "../components/TextMarks";
import { useItemIds } from "../components/useItemIds";
import { addedBy, parseDamage } from "../damage";
import { isPowerPath, modSources, modsAt, modsGrid, powerPR, refsAt, statAt, type WeaponStat } from "../state/damage";
import { damageSuggestions, insertTerm, termAt, termParts } from "../state/damageSuggestions";
import { castCap } from "../state/psychic";

type Owner = "weapon" | "power";

interface Texts {
    noun: string;
    own: string;
    placeholder: string;
    hint: string;
}

const TEXTS: { [O in Owner]: { [S in WeaponStat]: Texts } & { label: string; plural: string } } = {
    weapon: {
        label: "Weapon",
        plural: "weapon",
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
    },
    power: {
        label: "Power",
        plural: "power",
        damage: {
            noun: "damage",
            own: "The power's own damage, as the rulebook gives it; PR is the PR of its cast",
            placeholder: "1d10+2×PR",
            hint: "Add W.b, PR, 1d10 or a number.",
        },
        pen: {
            noun: "penetration",
            own: "The power's own penetration, as the rulebook gives it; PR is the PR of its cast",
            placeholder: "PR",
            hint: "Add PR, bPR or a number.",
        },
    },
};

const exprTitle = (noun: string, owner: Owner) => [
    `What the modifier adds to the ${noun}:`,
    "S.b — the bonus of a characteristic",
    "½WS.b, 1/2 WS.b, 0.5WS.b — a part of it, rounded down; ½WS.b▲ rounds up",
    "2×bPR — twice the base psy rating",
    ...(owner === "power" ? ["PR — the PR of the cast; PRd10 — d10 as many"] : []),
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
function ExprField({ path, itemPath, noun, owner }: { path: string; itemPath: string; noun: string; owner: Owner }) {
    const { stats } = useSheet();
    const inputRef = useRef<HTMLInputElement>(null);
    const expr = String(valueAt(`${path}.expr`) ?? "");
    const { keys, named, valueOf } = refsAt(itemPath);
    const suggest = (query: string | null) => damageSuggestions(stats.characteristics, query, valueOf, named);
    const typing = useQueryAtCaret(inputRef, termAt);
    const unfinished = typing !== null && suggest(typing).length > 0;
    const invalid = parseDamage(expr, keys, named).invalid.filter(t => !(unfinished && t === typing));
    const title = exprTitle(noun, owner);
    return (
        <span class="mod-expr-wrap">
            <SuggestField inputRef={inputRef} field="expr" class={invalid.length ? "mod-expr invalid" : "mod-expr"}
                placeholder={owner === "power" ? "PR, W.b, 1d10" : "S.b, ½WS.b, 1d5"}
                title={invalid.length ? `Unknown: ${invalid.join(", ")}. The modifier is off.\n\n${title}` : title}
                suggest={suggest} queryAt={termAt} insert={insertTerm} />
            {invalid.length > 0 && <TextMarks inputRef={inputRef} parts={termParts(expr, invalid)} />}
        </span>
    );
}

function ModRow({ itemId, itemPath, noun, owner }: { itemId: string; itemPath: string; noun: string; owner: Owner }) {
    const path = joinPath(usePath(), itemId);
    const added = useComputed(() => {
        const { keys, named, valueOf } = refsAt(itemPath);
        const { terms, invalid } = parseDamage(String(valueAt(`${path}.expr`) ?? ""), keys, named);
        return invalid.length || terms.length === 0 ? "—" : addedBy(terms, valueOf);
    });
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
function CopyFrom({ path, stat, owner }: { path: string; stat: WeaponStat; owner: Owner }) {
    const { canEdit, actions } = useSheet();
    const sources = modSources(path, stat);
    const groups = [...new Set(sources.map(s => s.group))];
    const { plural } = TEXTS[owner];
    const copy = (from: string) => actions.batch(path, { [`${stat}Mods`]: modsGrid(untracked(() => modsAt(from, stat)), stat) });
    return (
        <select class="mod-copy" title={`Replace the modifiers with those of another ${plural}`} disabled={!canEdit}
            onChange={e => {
                const from = e.currentTarget.value;
                e.currentTarget.value = "";
                if (from) copy(from);
            }}>
            <option value="">Copy from…</option>
            {sources.length === 0 && <option value="" disabled>{`No other ${plural} has modifiers`}</option>}
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

/** The field of `stat` of the attack, melee profile or psychic power at the enclosing path. */
export function ModdedField({ stat }: { stat: WeaponStat }) {
    const path = usePath();
    const owner: Owner = isPowerPath(path) ? "power" : "weapon";
    const texts = TEXTS[owner][stat];
    const ref = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLInputElement>(null);
    const dropdown = useDropdown(ref);
    const resolved = useComputed(() => statAt(path, stat));
    const text = useComputed(() => resolved.value.text);
    const pr = useComputed(() => (owner === "power" ? powerPR(path) : 0)).value;
    const hasMods = useItemIds(`${path}.${stat}Mods.items`).ids.length > 0;
    const { parts, parsed } = resolved.value;
    const base = String(valueAt(`${path}.${stat}`) ?? "").trim();
    const own = owner === "power" ? `Power ${base}, PR ${pr}` : `Weapon ${base}`;
    // A power's total is worth explaining without modifiers: it counts its PR.
    const title = parts.length || (owner === "power" && parsed) ? [own, ...parts].join("\n") : undefined;

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
            <button type="button" class={dropdown.open ? "mod-toggle active" : "mod-toggle"} title={`Modifiers of the ${texts.noun}`}
                onClick={dropdown.toggle}>⚙</button>
            {/* Rendered only while open: a dropdown per item would hold a sortable grid each. */}
            {dropdown.open && (
                <div class="roll-dropdown mod-dropdown visible">
                    <label class="mod-base" title={texts.own}>
                        <span class="column-label">{TEXTS[owner].label}</span>
                        <TextField field={stat} inputRef={baseRef} placeholder={texts.placeholder} />
                    </label>
                    {owner === "power" && <CastPR path={path} />}
                    <div class="mods-header">
                        <span class="column-label">Modifiers</span>
                        <CopyFrom path={path} stat={stat} owner={owner} />
                    </div>
                    {!hasMods && <p class="mod-hint">{texts.hint}</p>}
                    <ItemGrid dataId={`${stat}Mods.items`} class="weapon-mods" itemClass="weapon-mod" idPrefix={`${stat}-mod`}
                        renderItem={id => <ModRow itemId={id} itemPath={path} noun={texts.noun} owner={owner} />} />
                    {hasMods && base && !parsed && (
                        <p class="mod-note">{`The ${owner}'s ${texts.noun} is no expression: the modifiers do not count.`}</p>
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
