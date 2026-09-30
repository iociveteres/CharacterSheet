// The maximum or restoration of cognition or energy (state/tech.ts
// resourceStat): the bar shows the total; a click on it or the gear next to it
// opens the dropdown with the base, the default of the rules while empty, and
// the modifiers of implants and talents, each named by its source.
import { useEffect, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { joinPath, usePath, useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox, NumberField, ReadonlyField, Select, TextField } from "../components/fields";
import { RESOURCES } from "../schema/constants";
import type { SheetSignals } from "../schema/sheet";
import { DeleteButton, DragHandle } from "../components/ItemControls";
import { ItemGrid } from "../components/ItemGrid";
import { Scope } from "../components/Scope";
import { SuggestField, filterGroups, type SuggestionGroup } from "../components/SuggestField";
import { useItemIds } from "../components/useItemIds";
import { refKeys, refValue } from "../state/damage";
import { damageSuggestions } from "../state/damageSuggestions";
import { ExprInput } from "./ModdedField";
import { idsInOrder } from "../state/gridOrder";
import { numberAt, textAt, valueAt } from "../state/sync";
import { RESOURCE_DEFAULTS, RESOURCE_REFS, resourceStat, resourceValue, type ResourceKey } from "../state/tech";

const TEXTS: { [K in ResourceKey]: { noun: string; rule: string } } = {
    cognitionMax: { noun: "maximum of cognition", rule: "⚙ up to I.b" },
    cognitionRestore: { noun: "cognition a turn restores", rule: "½I.b▲ ⚙ a turn" },
    energyMax: { noun: "maximum of energy", rule: "a Potentia Coil holds 3 🗲 (Poor.Q 1, Good.Q 5, Best.Q 7)" },
    energyRestore: { noun: "energy a turn restores", rule: "a turn restores no 🗲" },
};

// The lists whose items give modifiers, by their label in the suggestions.
const SOURCES: [string, string][] = [["Cybernetics", "cybernetics"], ["Talents", "talents"], ["Traits", "traits"], ["Gear", "gear"]];

/** The names of the implants, talents, traits and gear of the sheet, as a modifier's source. */
function sourceNames(state: SheetSignals, query: string | null): SuggestionGroup[] {
    const groups = SOURCES.map(([label, list]) => ({
        label,
        options: [...new Set(idsInOrder(state, `${list}.list.items`)
            .map(id => textAt(state, `${list}.list.items.${id}.name`).trim())
            .filter(Boolean))],
    }));
    return filterGroups(groups.filter(g => g.options.length > 0), query);
}

export const signed = (n: number) => (n < 0 ? String(n) : `+${n}`);

const EXPR_TITLE = [
    "What the modifier adds:",
    "-1, 2 — a number",
    "I.b — the bonus of a characteristic",
    "½I.b, 1/2 I.b — a part of it, rounded down; ½I.b▲ rounds up",
    "I.b+1 — several at once",
    "Case does not matter. Dice or an unknown term turn the modifier off.",
].join("\n");

/** The expression of a modifier, with the suggestions of a damage modifier but dice and psy ratings (damageSuggestions). */
function ExprField({ path, invalid }: { path: string; invalid: boolean }) {
    const { state, stats } = useSheet();
    return (
        <ExprInput path={path} keys={refKeys(state)} named={RESOURCE_REFS} placeholder="-1, ½I.b" title={EXPR_TITLE}
            empty={invalid ? "Reads as no number" : null}
            suggest={query => damageSuggestions(stats.characteristics, query, ref => refValue(state, ref), RESOURCE_REFS, false)} />
    );
}

/** A modifier of a stat of cognition or energy, or of the cost of the Processes with the resource it takes. */
export function ModRow({ itemId, resource = false }: { itemId: string; resource?: boolean }) {
    const { state } = useSheet();
    const path = joinPath(usePath(), itemId);
    const value = useComputed(() => resourceValue(state, textAt(state, `${path}.expr`))).value;
    const expr = textAt(state, `${path}.expr`).trim();
    const enabled = !!valueAt(state, `${path}.enabled`);
    return (
        <Scope dataId={itemId} class={enabled ? "weapon-mod resource-mod" : "weapon-mod resource-mod disabled"}>
            <Checkbox field="enabled" class="custom" title="Counts in the total" />
            <span class="mod-name-wrap">
                <SuggestField field="name" class="mod-name" placeholder="Source" title="The implant, talent or item that gives it"
                    suggest={query => sourceNames(state, query)} />
            </span>
            <ExprField path={path} invalid={expr !== "" && value === null} />
            {resource && <Select field="resource" options={RESOURCES} class="mod-resource" title="What it adds to: cognition or energy" />}
            <span class="mod-added" data-id="added">{value === null ? "—" : signed(value)}</span>
            <DragHandle />
            <DeleteButton itemPath={path} />
        </Scope>
    );
}

/** The field of the stat `stat` of Techno Arcana, at the enclosing path. */
export function ResourceField({ stat }: { stat: ResourceKey }) {
    const { state } = useSheet();
    const { noun, rule } = TEXTS[stat];
    const path = joinPath(usePath(), stat);
    const ref = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLInputElement>(null);
    const dropdown = useDropdown(ref);
    const value = useComputed(() => resourceStat(state, stat));
    const total = useComputed(() => value.value.total);
    const hasMods = useItemIds(`${path}.mods.items`).ids.length > 0;
    const { base, byDefault, baseValue, mods } = value.value;
    const title = [
        `${byDefault ? "By the rules" : "Base"} ${base}${baseValue === null ? ": reads as no number" : ` = ${baseValue}`}`,
        ...mods.map(m => `${m.name || m.expr} ${signed(m.value)}`),
    ].join("\n");

    // A click on the total opens the dropdown at the base.
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
        <div class="mod-field resource-field dropdown-parent" ref={ref}>
            <ReadonlyField field={`${stat}Total`} value={total} type="number" class="mod-total" title={title} onClick={editBase} />
            <button type="button" class={dropdown.open ? "mod-toggle active" : "mod-toggle"} title={`Base and modifiers of the ${noun}`}
                onClick={dropdown.toggle}>⚙</button>
            {/* Rendered only while open, as ModdedField's. */}
            {dropdown.open && (
                <Scope dataId={stat} class="roll-dropdown mod-dropdown resource-dropdown visible">
                    <label class="mod-base" title={`The ${noun} before the modifiers; empty for the rules: ${rule}`}>
                        <span class="column-label">Base</span>
                        <TextField field="base" inputRef={baseRef} placeholder={RESOURCE_DEFAULTS[stat]} />
                    </label>
                    {byDefault && <p class="mod-note-quiet" data-id="rule">{`By the rules: ${rule}`}</p>}
                    {!byDefault && baseValue === null && <p class="mod-note" data-id="badBase">The base reads as no number: only the modifiers count.</p>}
                    <div class="mods-header">
                        <span class="column-label">Modifiers</span>
                    </div>
                    {!hasMods && <p class="mod-hint">An implant or talent, as Explorator −1.</p>}
                    <ItemGrid dataId="mods.items" class="weapon-mods" itemClass="weapon-mod" idPrefix={`${stat}-mod`}
                        renderItem={id => <ModRow itemId={id} />} />
                    <div class="mod-result">
                        <span class="column-label">Total</span>
                        <span class="mod-result-value" data-id="result">{total}</span>
                    </div>
                </Scope>
            )}
        </div>
    );
}

/**
 * The current cognition or energy, at the enclosing path: typed up to its
 * maximum `max`. When the maximum drops under it, it stays as it is, marked,
 * until the next edit.
 */
export function CurrentResource({ field, max }: { field: "currentCognition" | "currentEnergy"; max: ResourceKey }) {
    const { state, actions } = useSheet();
    const path = joinPath(usePath(), field);
    const top = useComputed(() => resourceStat(state, max).total).value;
    const over = numberAt(state, path) > top;
    return (
        <NumberField field={field} class={over ? "short over-max" : "short"} max={top}
            title={over ? `More than the maximum, ${top}` : `Up to the maximum, ${top}`}
            onEdit={value => actions.change(path, value === null ? null : Math.min(value, top))} />
    );
}
