// The prepared spells of Pathfinder Crusade (state/prepared.ts): the mark at
// the left of a spell's header and the class its card takes. None of it shows
// for a gift that does not prepare (StatSet.preparingGifts, none in Black
// Crusade) or while the rule is off.
import { useComputed } from "@preact/signals";
import { usePath, useSheet } from "../components/context";
import { preparing } from "../state/prepared";
import { valueAt } from "../state/sync";

/** Whether the spell at `path` is prepared; null while the sheet does not count preparation, or for no path (a tech power). */
export function usePrepared(path: string | null): boolean | null {
    const { state, stats } = useSheet();
    return useComputed(() => (path !== null && preparing(state, stats.preparingGifts) ? !!valueAt(state, `${path}.prepared`) : null)).value;
}

/** The card class of a spell that is or is not prepared. */
export const preparedClass = (prepared: boolean | null) => (prepared === null ? "" : prepared ? " prepared" : " unprepared");

/** The bookmark that prepares the spell of the enclosing Scope for the day, or unprepares it. */
export function PreparedToggle({ prepared }: { prepared: boolean }) {
    const { actions, canEdit, terms } = useSheet();
    const path = usePath();
    return (
        <button type="button" data-id="prepared" class={prepared ? "prepared-toggle active" : "prepared-toggle"} aria-pressed={prepared}
            disabled={!canEdit} title={prepared ? `Prepared for today: unprepare the ${terms.power}` : `Not prepared: prepare the ${terms.power} for today`}
            onClick={() => actions.change(`${path}.prepared`, !prepared)}>
            <svg viewBox="0 0 10 14" aria-hidden="true"><path d="M1.5 1.5h7v11L5 10 1.5 12.5z" /></svg>
        </button>
    );
}
