// The Reload of a ranged attack with what changes it (weapons/reloadRules.ts), as
// Balance shows its own: the total, and under ⚙ the weapon's own value, the
// entries that changed it and the unit the kind's tables count in.
import { useComputed } from "@preact/signals";
import { t } from "../../i18n";
import { usePath, useSheet } from "../components/context";
import { peekAt } from "../core/sync";
import { reloadAt } from "./reloadRules";
import { BreakdownField, breakdownTitle } from "./Grips";

const UNIT_NOTES = {
    1: t("sheet.weapons.reload.halfActions"),
    2: t("sheet.weapons.reload.actions"),
} as const;

/** The Reload of the ranged attack at the enclosing path. */
export function ReloadField() {
    const { state, stats } = useSheet();
    const path = usePath();
    const reload = useComputed(() => reloadAt(state, path, stats.reloadUnit));
    const own = String(peekAt(state, `${path}.reload`) ?? "");
    const note = UNIT_NOTES[stats.reloadUnit];
    const title = [breakdownTitle(reload.value, own), note].filter(Boolean).join("\n\n");
    return (
        <BreakdownField field="reloadTotal" baseField="reload" value={reload} title={title}
            toggleTitle={t("sheet.weapons.reloadToggle")} placeholder={stats.reloadUnit === 1 ? "2" : "1"}>
            <p class="mod-note-quiet" data-id="unit">{note}</p>
        </BreakdownField>
    );
}
