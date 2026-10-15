// Spellcasting, the class traits of a caster of Pathfinder Crusade
// (state/spellcasting.ts): the row that picks them first in the Magic tab,
// in place of the gift, what it says of the base PR, the variant a PR spell's
// roll is cast by while two PR variants are ticked, and the variants in the
// stat block. Only the layout of Pathfinder Crusade includes the row and the
// stat block line; the roll's column needs two PR variants ticked, which a
// sheet without the spellcasting block, Black Crusade, never has.
import { useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { useDropdown } from "../components/Dropdown";
import { Checkbox } from "../components/fields";
import { Scope } from "../components/Scope";
import type { SpellcastingVariant } from "../schema/constants";
import { prCapWarning, prVariants, spellVariant, tickedVariants } from "../state/spellcasting";

/** The row of the variant in the table of the rules, as its toggle's title. */
function variantTitle(v: SpellcastingVariant): string {
    if (v.way === "sorcery") {
        return `${v.label} Spellcasting: Sorcery spells of the ${(v.classes ?? []).join(" or ")}, tested on their skill; ${v.pool} ${v.base}`;
    }
    return `${v.label} Spellcasting: spells cast by PR, Cast on ${v.test}; Mana ${v.base}; ${v.gift} gift; `
        + (v.prepares ? "prepares the spells of the day" : "casts any spell known");
}

/** What the variant gives, under its name in the list: "Cast on I · Arcane gift · Mana 2×I.b+2×bPR · prepares". */
function variantSummary(v: SpellcastingVariant): string {
    if (v.way === "sorcery") return `${(v.classes ?? [])[0]} spells, tested on their skill · ${v.pool} ${v.base}`;
    return [`Cast on ${v.test}`, `${v.gift} gift`, `Mana ${v.base}`, ...(v.prepares ? ["prepares"] : [])].join(" · ");
}

const WAYS: readonly { way: SpellcastingVariant["way"]; label: string }[] = [
    { way: "pr", label: "Cast by PR" },
    { way: "sorcery", label: "Sorcery" },
];

/**
 * The variants ticked, as one button that opens the list of all of them: a
 * caster ticks those of their classes. One line however many the kind has.
 */
export function SpellcastingRow() {
    const { state, stats } = useSheet();
    const ref = useRef<HTMLDivElement>(null);
    const dropdown = useDropdown(ref);
    const labels = useComputed(() => tickedVariants(state).map(v => v.label).join(", ")).value;
    return (
        <Scope dataId="spellcasting" class="layout-row spellcasting-row">
            <span class="spellcasting-label">Spellcasting:</span>
            <div class="spellcasting-picker dropdown-parent" ref={ref}>
                <button type="button" data-id="picker" class={dropdown.open ? "spellcasting-summary active" : "spellcasting-summary"}
                    aria-expanded={dropdown.open} title="The Spellcasting of your classes" onClick={dropdown.toggle}>
                    {labels || <span class="spellcasting-none">none</span>}
                </button>
                {dropdown.open && (
                    <div class="roll-dropdown roll-dropdown-centered spellcasting-dropdown visible">
                        {WAYS.map(({ way, label }) => {
                            const variants = stats.spellcasting.filter(v => v.way === way);
                            if (variants.length === 0) return null;
                            return (
                                <div key={way} class="spellcasting-group">
                                    <span class="column-label">{label}</span>
                                    {variants.map(v => (
                                        <label key={v.key} class="spellcasting-option" title={variantTitle(v)}>
                                            <Checkbox field={v.key} class="custom" />
                                            <span>
                                                <span class="spellcasting-option-label">{v.label}</span>
                                                <span class="spellcasting-option-text">{variantSummary(v)}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Scope>
    );
}

/** Above the base PR, which it marks, while it is past the bonus of the casting characteristic; the PR is not stopped. */
export function PRCapWarning() {
    const { state } = useSheet();
    const warning = useComputed(() => prCapWarning(state)).value;
    if (!warning) return null;
    return <span class="pr-cap-warning" data-id="prCap" title={warning}>{warning}</span>;
}

/** The PR variants ticked, first on the PR line of the stat block. */
export function StatSpellcasting() {
    const { state } = useSheet();
    const labels = useComputed(() => prVariants(state).map(v => v.label).join(", ")).value;
    return labels ? <span data-id="spellcasting" title="Spellcasting">{labels}</span> : null;
}

/**
 * The PR variant the spell at `path` is cast by, which gives it its gift and
 * the characteristic of Cast. Shown while two or more are ticked; the first
 * is the default, so a spell keeps "" until one is picked.
 */
export function SpellcastingColumn({ path }: { path: string }) {
    const { state, actions, canEdit } = useSheet();
    const variants = useComputed(() => prVariants(state)).value;
    const current = useComputed(() => spellVariant(state, path)?.key ?? "").value;
    if (variants.length < 2) return null;
    return (
        <div class="roll-column spellcasting-column">
            <label class="column-label">Spellcasting</label>
            <div class="roll-column-content">
                <select data-id="spellcasting" value={current} disabled={!canEdit}
                    title="The Spellcasting the spell is cast by: its gift and what Cast tests it on"
                    onChange={e => actions.change(`${path}.roll.spellcasting`, e.currentTarget.value)}>
                    {variants.map(v => <option key={v.key} value={v.key} title={`Tested on ${v.test}, ${v.gift} gift`}>{v.label}</option>)}
                </select>
            </div>
        </div>
    );
}
