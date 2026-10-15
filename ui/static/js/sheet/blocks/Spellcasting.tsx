// Spellcasting, the class traits of a caster of Pathfinder Crusade
// (state/spellcasting.ts): the row of their toggles first in the Magic tab,
// in place of the gift, what it says of the base PR, the variant a PR spell's
// roll is cast by while two PR variants are ticked, and the variants in the
// stat block. Only the layout of Pathfinder Crusade includes the row and the
// stat block line; the roll's column needs two PR variants ticked, which a
// sheet without the spellcasting block, Black Crusade, never has.
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { Scope } from "../components/Scope";
import type { SpellcastingVariant } from "../schema/constants";
import { prCapWarning, prVariants, spellVariant, tickedVariants } from "../state/spellcasting";

export const SPELLCASTING_NOTICE = "Tick the Spellcasting of your class at the top of the tab: it gives the spells their test "
    + "(Cast), gift and preparation, and the maximum of the mana and of each Focus.";

/** The row of the variant in the table of the rules, as its toggle's title. */
function variantTitle(v: SpellcastingVariant): string {
    if (v.way === "sorcery") {
        return `${v.label} Spellcasting: Sorcery spells of the ${(v.classes ?? []).join(" or ")}, tested on their skill; ${v.pool} ${v.base}`;
    }
    return `${v.label} Spellcasting: spells cast by PR, Cast on ${v.test}; Mana ${v.base}; ${v.gift} gift; `
        + (v.prepares ? "prepares the spells of the day" : "casts any spell known");
}

/** The toggles of the Spellcasting variants, in the kind's order: a caster ticks those of their classes. */
export function SpellcastingRow() {
    const { state, stats, actions, canEdit } = useSheet();
    const ticked = useComputed(() => tickedVariants(state).map(v => v.key)).value;
    return (
        <Scope dataId="spellcasting" class="layout-row spellcasting-row">
            <span class="spellcasting-label">Spellcasting:</span>
            {stats.spellcasting.map(v => {
                const on = ticked.includes(v.key);
                return (
                    <button key={v.key} type="button" data-id={v.key} class={on ? "spellcasting-toggle active" : "spellcasting-toggle"}
                        aria-pressed={on} disabled={!canEdit} title={variantTitle(v)}
                        onClick={() => actions.change(`spellcasting.${v.key}`, !on)}>{v.label}</button>
                );
            })}
        </Scope>
    );
}

/** ⚠ by the base PR while it is past the bonus of the casting characteristic; the PR is not stopped. */
export function PRCapWarning() {
    const { state } = useSheet();
    const warning = useComputed(() => prCapWarning(state)).value;
    if (!warning) return null;
    return <span class="pr-cap-warning" data-id="prCap" title={warning}>⚠</span>;
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
