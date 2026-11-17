// The prepared spells of Pathfinder Crusade (magic/preparedRules.ts): the mark at
// the left of a spell's header, the warning of its roll and the row under the
// mana. None of it shows without a Spellcasting variant that prepares
// (magic/spellcastingRules.ts, none in Black Crusade) or while the rule is off;
// the mark and the warning neither for a spell cast by a variant that does not.
import { useComputed } from "@preact/signals";
import { t } from "../../i18n";
import { usePath, useSheet } from "../components/context";
import { needsPreparing, preparedCount, preparedLimit, preparing, unprepareAll } from "./preparedRules";
import { valueAt } from "../core/sync";
import type { Rule } from "../components/kindParts";
import { RollRow } from "../rolls/rollParts";

export const PREPARED_RULE: Rule = {
    field: "prepared",
    label: t("sheet.termsPf.magic.prepared"),
    title: t("sheet.magicPf.prepared.ruleTitle"),
};

/** Whether the spell at `path` is prepared; null while it needs no preparing (needsPreparing) or for no path (a tech power). */
export function usePrepared(path: string | null): boolean | null {
    const { state } = useSheet();
    return useComputed(() => (path !== null && needsPreparing(state, path)
        ? !!valueAt(state, `${path}.prepared`) : null)).value;
}

/** The bookmark that prepares the spell of the enclosing Scope for the day, or unprepares it. */
export function PreparedToggle({ prepared }: { prepared: boolean }) {
    const { actions, canEdit } = useSheet();
    const path = usePath();
    return (
        <button type="button" data-id="prepared" class={prepared ? "prepared-toggle active" : "prepared-toggle"} aria-pressed={prepared}
            disabled={!canEdit} title={prepared ? t("sheet.magicPf.prepared.unprepareTitle") : t("sheet.magicPf.prepared.prepareTitle")}
            onClick={() => actions.change(`${path}.prepared`, !prepared)}>
            <svg viewBox="0 0 10 14" aria-hidden="true"><path d="M1.5 1.5h7v11L5 10 1.5 12.5z" /></svg>
        </button>
    );
}

/** The warning of the roll of an unprepared spell; the roll itself is not stopped, nor its mana spared. */
export function PreparedRollRow({ path }: { path: string }) {
    if (usePrepared(path) !== false) return null;
    return (
        <RollRow label={t("sheet.magicPf.prepared.rowLabel")} class="prepared-roll-row">
            <span class="pr-warning" data-id="notPrepared" title={t("sheet.magicPf.prepared.notPreparedTitle")}>{t("sheet.magicPf.prepared.notPrepared")}</span>
        </RollRow>
    );
}

/** Prepared Spells: how many of the day's limit, I.b + Base PR, and Unprepare All. Only the layout of Pathfinder Crusade includes it. */
export function PreparedRow() {
    const { state, actions, canEdit } = useSheet();
    const shown = useComputed(() => preparing(state)).value;
    const count = useComputed(() => preparedCount(state)).value;
    const limit = useComputed(() => preparedLimit(state)).value;
    if (!shown) return null;
    const over = count > limit;
    return (
        <div class="layout-row prepared-row" data-id="preparedSpells">
            <span class={over ? "prepared-count over" : "prepared-count"} data-id="preparedCount"
                title={over ? t("sheet.magicPf.prepared.over", { limit }) : t("sheet.magicPf.prepared.limitTitle")}>
                {`${t("sheet.termsPf.magic.prepared")}: ${count} / ${limit}`}
            </span>
            <button type="button" data-id="unprepareAll" class="unprepare-all" disabled={!canEdit || count === 0}
                title={count === 0 ? t("sheet.magicPf.prepared.noneTitle") : t("sheet.magicPf.prepared.unprepareAllTitle")}
                onClick={() => unprepareAll({ state, actions })}>{t("sheet.magicPf.prepared.unprepareAll")}</button>
        </div>
    );
}
