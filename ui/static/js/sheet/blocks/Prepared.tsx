// The prepared spells of Pathfinder Crusade (state/prepared.ts): the mark at
// the left of a spell's header, the warning of its roll and the row under the
// mana. None of it shows for a gift that does not prepare
// (StatSet.preparingGifts, none in Black Crusade) or while the rule is off.
import { useComputed } from "@preact/signals";
import { usePath, useSheet } from "../components/context";
import { preparedCount, preparedLimit, preparing, unprepareAll } from "../state/prepared";
import { isSorcery } from "../state/psychic";
import { valueAt } from "../state/sync";
import type { Rule } from "./BlockSettings";
import { RollRow } from "./Processes";

export const PREPARED_RULE: Rule = {
    field: "prepared",
    label: "Prepared spells",
    title: "An Arcane or Bound caster prepares up to I.b + PR spells a day; the casts of the rest warn.",
};

export const PREPARED_NOTICE = "An Arcane or Bound caster marks the spells prepared for the day with the bookmark at the left of a spell, "
    + "up to I.b + Base PR; the casts of the rest warn. Unprepare All under the mana starts a new day.";

/** Whether the spell at `path` is prepared; null while the sheet does not count preparation, for a Sorcery spell or for no path (a tech power). */
export function usePrepared(path: string | null): boolean | null {
    const { state, stats } = useSheet();
    return useComputed(() => (path !== null && preparing(state, stats.preparingGifts) && !isSorcery(state, path)
        ? !!valueAt(state, `${path}.prepared`) : null)).value;
}

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

/** The warning of the roll of an unprepared spell; the roll itself is not stopped, nor its mana spared. */
export function PreparedRollRow({ path }: { path: string }) {
    const { terms } = useSheet();
    if (usePrepared(path) !== false) return null;
    return (
        <RollRow label="Prepared" class="prepared-roll-row">
            <span class="pr-warning" data-id="notPrepared" title={`The ${terms.power} was not prepared today; it can be cast all the same`}>Not prepared</span>
        </RollRow>
    );
}

/** Prepared Spells: how many of the day's limit, I.b + Base PR, and Unprepare All. Only the layout of Pathfinder Crusade includes it. */
export function PreparedRow() {
    const { state, actions, canEdit, stats, terms } = useSheet();
    const shown = useComputed(() => preparing(state, stats.preparingGifts)).value;
    const count = useComputed(() => preparedCount(state)).value;
    const limit = useComputed(() => preparedLimit(state)).value;
    if (!shown) return null;
    const over = count > limit;
    return (
        <div class="layout-row prepared-row" data-id="preparedSpells">
            <span class={over ? "prepared-count over" : "prepared-count"} data-id="preparedCount"
                title={over
                    ? `More ${terms.powers} prepared than a day allows: I.b + Base PR is ${limit}`
                    : `A day allows I.b + Base PR ${terms.powers} prepared`}>
                {`Prepared ${terms.Powers}: ${count} / ${limit}`}
            </span>
            <button type="button" data-id="unprepareAll" class="unprepare-all" disabled={!canEdit || count === 0}
                title={count === 0 ? `No ${terms.power} is prepared` : `Unprepare every ${terms.power} for a new day; the sustained stay sustained`}
                onClick={() => unprepareAll({ state, actions })}>Unprepare All</button>
        </div>
    );
}
