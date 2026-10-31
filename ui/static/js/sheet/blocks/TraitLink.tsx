// How a melee attack becomes a profile of a Natural Weapons trait
// (state/traitLink.ts): the In Traits group of its name's autocomplete, and X
// put in at a rulebook pick of a profile. Its name marks the link
// (AttackLinkMark in ItemLink.tsx).
import type { LocalResults } from "../components/AutocompleteField";
import { useSheet, type AutocompleteResult, type SheetEnv } from "../components/context";
import { entryName, naturalTraits, pickedRating, profilesOf } from "../state/traitLink";
import { linkAttack } from "./ItemLink";

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
        pick: r => void linkAttack(env, attackPath, "melee", base, { trait: String(r.traitId), item: "" }, r.name),
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
