// The initiative roll of a sheet. The raw roll is kept in lastInitiative, so
// the total the sheet shows follows the modifier as it changes. The sheet's
// own rolls bring the result back, so a sheet that is not rendered (an NPC of
// an encounter) keeps its roll too.
import type { SheetOps } from "./actions";
import { peekAt } from "./sync";

/** Rolls the initiative of the sheet and keeps the roll less the modifier it has when the roll is back. */
export async function rollInitiative({ state, actions, rolls }: SheetOps): Promise<void> {
    const expression = String(peekAt(state, "initiative.initiative") ?? "").trim();
    if (!expression) return;
    const total = await rolls.exact(expression, "Initiative");
    if (total === null) return;
    actions.change("initiative.lastInitiative", total - (Number(peekAt(state, "initiative.modifier")) || 0));
}
