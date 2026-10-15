// Spellcasting, the class traits of a caster of Pathfinder Crusade
// (state/spellcasting.ts): in the roll of a PR spell the variant it is cast
// by, while two PR variants are ticked. A sheet without the spellcasting
// block, Black Crusade, has none of it.
import { useComputed } from "@preact/signals";
import { useSheet } from "../components/context";
import { prVariants, spellVariant } from "../state/spellcasting";

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
