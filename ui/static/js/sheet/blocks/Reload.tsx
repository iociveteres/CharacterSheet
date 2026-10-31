// The Reload of a ranged attack with what changes it (state/reload.ts), as
// Balance shows its own: the total, and under ⚙ the weapon's own value, the
// entries that changed it and the unit the kind's tables count in.
import { useComputed } from "@preact/signals";
import { usePath, useSheet } from "../components/context";
import { peekAt } from "../state/sync";
import { reloadAt } from "../state/reload";
import { BreakdownField, breakdownTitle } from "./Grips";

const UNIT_NOTES = {
    1: "In half-actions; Free is a free action.",
    2: "In actions: ½ is a half-action, 1 a full one; Free is a free action.",
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
            toggleTitle="Reload of the weapon and what changes it" placeholder={stats.reloadUnit === 1 ? "2" : "1"}>
            <p class="mod-note-quiet" data-id="unit">{note}</p>
        </BreakdownField>
    );
}
