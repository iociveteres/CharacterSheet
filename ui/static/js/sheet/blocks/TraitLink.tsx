// What a melee attack shows of the Natural Weapons trait it is a profile of
// (state/traitLink.ts): the Trait row under its header, the In Traits group of
// its name's autocomplete, and X put in at a rulebook pick of a profile.
import { useComputed } from "@preact/signals";
import type { LocalResults } from "../components/AutocompleteField";
import { useSheet, type AutocompleteResult, type SheetEnv } from "../components/context";
import { Select } from "../components/fields";
import { entryName, naturalTraits, pickedRating, profilesOf, traitLinkOf } from "../state/traitLink";
import { textAt } from "../state/sync";
import { linkAttack } from "./ItemLink";

const TRAIT_TITLE = "The Natural Weapons trait of this attack: X in its name, as Natural Weapons (2), adds to the damage, and to Pen when it is Deadly";
const DELETED_TITLE = "The linked trait was deleted: it gives the attack nothing. Pick another or —.";

/** Why the trait named `name` gives nothing or 0, as the title of the row; null when X counts. */
function warning(name: string, rating: number | null | undefined): string | null {
    if (rating === undefined) return `${name} is no Natural Weapons trait: it gives the attack nothing. Pick another or —.`;
    if (rating === null) return `No number in the brackets of ${name}: X counts as 0. Put it in the trait's name, as Natural Weapons (2).`;
    return null;
}

/**
 * The Trait row of the melee attack at `attackPath`: — or one of the sheet's
 * Natural Weapons traits. Shown while the attack is linked, and to an editor
 * of a kind with these traits while the sheet has one and the attack has no
 * gear item.
 */
export function TraitLinkRow({ attackPath }: { attackPath: string }) {
    const { state, canEdit, stats } = useSheet();
    const link = useComputed(() => traitLinkOf(state, attackPath)).value;
    const options = useComputed(() => naturalTraits(state).map(({ id, name }) => ({ id, label: name }))).value;
    const item = textAt(state, `${attackPath}.item`);
    if (!link && (!canEdit || !stats.naturalWeapons.length || options.length === 0 || item)) return null;

    const deleted = link !== null && link.name === null;
    // A trait renamed into another one keeps its option.
    const own = link?.name && !options.some(o => o.id === link.id) ? [{ id: link.id, label: link.name }] : [];
    const warn = link?.name ? warning(link.name, link.natural ? link.natural.rating : undefined) : null;
    const cls = deleted || (link?.name && !link.natural) ? "item-link-select dimmed" : warn ? "item-link-select invalid" : "item-link-select";
    return (
        <div class="layout-row item-link-row">
            <label>Trait:
                <Select field="trait" class={cls} title={deleted ? DELETED_TITLE : warn ?? TRAIT_TITLE}>
                    <option value="">—</option>
                    {[...options, ...own].map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    {deleted && <option value={link.id}>deleted</option>}
                </Select>
            </label>
        </div>
    );
}

/**
 * The In Traits group of the name of the melee attack at `attackPath`: the
 * weapons of each Natural Weapons trait of the sheet, those its Y names or
 * all, whose name holds the query. A pick fills the attack from the
 * rulebook's profile and links it to the trait (linkAttack).
 */
export function useInTraits(attackPath: string, base: () => object): LocalResults {
    const env = useSheet();
    const { state, stats } = env;
    return {
        group: "In Traits",
        results: query => {
            const q = query.toLowerCase();
            return naturalTraits(state).flatMap(({ id, name, natural }) => profilesOf(stats.naturalWeapons, natural)
                .map(p => ({ name: entryName(p, natural), name_ru: p.ru, entryType: name, traitId: id }))
                .filter(r => r.name.toLowerCase().includes(q) || r.name_ru.toLowerCase().includes(q)));
        },
        pick: r => void linkAttack(env, attackPath, "melee", base, { trait: String(r.traitId) }, r.name),
    };
}

/**
 * Applies a pick of the melee collection's `result` to the attack at
 * `attackPath`. A Natural Weapons profile, which the result says by its
 * trait, gets X as modifiers, from the sheet's trait of that name or "X".
 */
export function applyMeleeEntry(env: Pick<SheetEnv, "state" | "actions">, attackPath: string, base: () => object, result: AutocompleteResult) {
    const rating = typeof result.trait === "string" && result.trait ? pickedRating(env.state, result.trait) : undefined;
    env.actions.autocompleteApply(attackPath, "melee", result.name, base(), rating);
}
